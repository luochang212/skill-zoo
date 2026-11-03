//! Public model metadata only: no provider credentials or user content leave the app.
use serde::Serialize;
use serde_json::Value;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const CATALOG_URL: &str = "https://models.dev/api.json";
const MAX_BYTES: usize = 16 * 1024 * 1024;
const TTL: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelRecommendation {
    pub context_window: Option<u32>,
    pub max_output_tokens: Option<u32>,
}

fn api_identity(raw: &str) -> Option<(String, String)> {
    let url = url::Url::parse(raw).ok()?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    // Only the API root differs for these official providers; never match subdomains by suffix.
    let host = url.host_str()?;
    let path = url.path().trim_end_matches('/');
    let path = if host == "api.deepseek.com" && path == "/v1" {
        ""
    } else {
        path
    };
    Some((url.origin().ascii_serialization(), path.to_string()))
}

pub fn lookup(catalog: &Value, base_url: &str, model_id: &str) -> Option<ModelRecommendation> {
    let target = api_identity(base_url)?;
    let entries = catalog.as_object()?;
    // Provider-specific limits matter: identical model IDs on different hosts are not interchangeable.
    for (id, provider) in entries {
        let api = provider
            .get("api")
            .and_then(Value::as_str)
            .or(match id.as_str() {
                "openai" => Some("https://api.openai.com/v1"),
                "anthropic" => Some("https://api.anthropic.com/v1"),
                _ => None,
            });
        if api.and_then(api_identity).as_ref() != Some(&target) {
            continue;
        }
        let Some(model) = provider
            .get("models")
            .and_then(|models| models.get(model_id.trim()))
        else {
            continue;
        };
        let limits = model.get("limit")?;
        let number = |key: &str| {
            limits
                .get(key)?
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .filter(|n| *n > 0)
        };
        let result = ModelRecommendation {
            context_window: number("context"),
            max_output_tokens: number("output"),
        };
        if result.context_window.is_none() && result.max_output_tokens.is_none() {
            return None;
        }
        if matches!((result.context_window, result.max_output_tokens), (Some(context), Some(output)) if output > context)
        {
            return None;
        }
        return Some(result);
    }
    None
}

async fn download(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let mut response = client
        .get(url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| "catalogUnavailable")?
        .error_for_status()
        .map_err(|_| "catalogUnavailable")?;
    if response
        .content_length()
        .is_some_and(|n| n > MAX_BYTES as u64)
    {
        return Err("catalogUnavailable".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "catalogUnavailable")? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("catalogUnavailable".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "catalogUnavailable")?;
    if !value.is_object() {
        return Err("catalogUnavailable".into());
    }
    Ok(value)
}

struct CachedCatalog {
    at: Instant,
    value: Result<Value, String>,
}

pub async fn resolve(
    base_url: &str,
    model_id: &str,
) -> Result<Option<ModelRecommendation>, String> {
    if api_identity(base_url).is_none() || model_id.trim().is_empty() {
        return Ok(None);
    }
    static CACHE: OnceLock<Mutex<Option<CachedCatalog>>> = OnceLock::new();
    let mut cache = CACHE.get_or_init(|| Mutex::new(None)).lock().await;
    if cache.as_ref().is_none_or(|cached| {
        cached.at.elapsed()
            >= if cached.value.is_ok() {
                TTL
            } else {
                Duration::from_secs(30)
            }
    }) {
        let value = download(crate::config::http_client(), CATALOG_URL).await;
        *cache = Some(CachedCatalog {
            at: Instant::now(),
            value,
        });
    }
    match &cache.as_ref().unwrap().value {
        Ok(value) => Ok(lookup(value, base_url, model_id)),
        Err(code) => Err(code.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn matches_exact_provider_and_model_without_guessing() {
        let data = json!({"openai":{"models":{"same":{"limit":{"context":1000,"output":200}}}},"other":{"api":"https://other.test/v1","models":{"same":{"limit":{"context":500,"output":50}}}}});
        assert_eq!(
            lookup(&data, "https://api.openai.com/v1/", "same")
                .unwrap()
                .max_output_tokens,
            Some(200)
        );
        assert_eq!(
            lookup(&data, "https://other.test/v1/", "same")
                .unwrap()
                .max_output_tokens,
            Some(50)
        );
        for url in [
            "https://api.openai.com.evil.test/v1",
            "https://proxy.test/v1",
            "https://api.openai.com/else",
            "https://api.openai.com:444/v1",
        ] {
            assert_eq!(lookup(&data, url, "same"), None);
        }
        assert_eq!(lookup(&data, "https://api.openai.com/v1", "same-new"), None);
    }

    #[test]
    fn normalizes_deepseek_and_rejects_unusable_limits() {
        let data = json!({"deepseek":{"api":"https://api.deepseek.com","models":{"m":{"limit":{"context":1000,"output":200}},"bad":{"limit":{"context":20,"output":200}},"image":{"limit":{"context":0,"output":0}}}}});
        assert!(lookup(&data, "https://api.deepseek.com/v1/", "m").is_some());
        assert_eq!(lookup(&data, "https://api.deepseek.com", "bad"), None);
        assert_eq!(lookup(&data, "https://api.deepseek.com", "image"), None);
    }

    #[tokio::test]
    async fn public_fetch_has_no_credentials_and_reports_malformed_responses() {
        let mut server = mockito::Server::new_async().await;
        let good = server
            .mock("GET", "/catalog")
            .match_header("authorization", mockito::Matcher::Missing)
            .match_header("x-api-key", mockito::Matcher::Missing)
            .with_body("{}")
            .create_async()
            .await;
        assert!(download(
            &reqwest::Client::new(),
            &format!("{}/catalog", server.url())
        )
        .await
        .is_ok());
        good.assert_async().await;
        let bad = server
            .mock("GET", "/bad")
            .with_body("not json")
            .create_async()
            .await;
        assert_eq!(
            download(&reqwest::Client::new(), &format!("{}/bad", server.url()))
                .await
                .unwrap_err(),
            "catalogUnavailable"
        );
        bad.assert_async().await;
        let large = server
            .mock("GET", "/large")
            .with_header("content-length", &(MAX_BYTES + 1).to_string())
            .create_async()
            .await;
        assert!(
            download(&reqwest::Client::new(), &format!("{}/large", server.url()))
                .await
                .is_err()
        );
        large.assert_async().await;
    }
}
