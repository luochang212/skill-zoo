use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
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
    let host = url.host_str()?;
    let path = url.path().trim_end_matches('/');
    let path = if host == "api.deepseek.com" && path == "/v1" {
        ""
    } else {
        path
    };
    Some((url.origin().ascii_serialization(), path.to_string()))
}

fn recommendation(model: &Value) -> Option<ModelRecommendation> {
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
    Some(result)
}

fn model_id_last_segment(model_id: &str) -> Option<&str> {
    model_id.rsplit('/').next()
}

fn is_manufacturer(provider_id: &str, model_id: &str) -> bool {
    let name = model_id_last_segment(model_id)
        .unwrap_or(model_id)
        .to_ascii_lowercase();
    match provider_id {
        "alibaba" | "alibaba-cn" => name.starts_with("qwen"),
        "zai" | "zhipuai" => name.starts_with("glm-"),
        "anthropic" => name.starts_with("claude-"),
        "openai" => {
            name.starts_with("gpt-")
                || name.starts_with("chatgpt-")
                || ["o1", "o3", "o4"]
                    .iter()
                    .any(|prefix| name == *prefix || name.starts_with(&format!("{prefix}-")))
        }
        "deepseek" => name.starts_with("deepseek-"),
        "moonshotai" | "moonshotai-cn" => {
            name.starts_with("kimi-") || name.starts_with("moonshot-")
        }
        "minimax" => name.starts_with("minimax-"),
        _ => false,
    }
}

fn modal_recommendation(candidates: &[Option<ModelRecommendation>]) -> Option<ModelRecommendation> {
    let mut counts = BTreeMap::new();
    for candidate in candidates.iter().flatten() {
        *counts
            .entry((candidate.context_window, candidate.max_output_tokens))
            .or_insert(0usize) += 1;
    }
    let max = counts.values().copied().max()?;
    candidates
        .iter()
        .flatten()
        .find(|candidate| {
            counts.get(&(candidate.context_window, candidate.max_output_tokens)) == Some(&max)
        })
        .cloned()
}

pub fn lookup(catalog: &Value, base_url: &str, model_id: &str) -> Option<ModelRecommendation> {
    let target = api_identity(base_url)?;
    let model_id = model_id.trim();
    if model_id.is_empty() {
        return None;
    }
    let entries = catalog.as_object()?;
    for tier in 0..5 {
        let mut candidates = Vec::new();
        for (id, provider) in entries {
            if tier == 0 {
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
            }
            if matches!(tier, 1 | 2) && !is_manufacturer(id, model_id) {
                continue;
            }
            let Some(models) = provider.get("models").and_then(Value::as_object) else {
                continue;
            };
            for (id, model) in models {
                let matched = if matches!(tier, 0 | 1 | 3) {
                    id == model_id
                } else {
                    model_id_last_segment(id) == model_id_last_segment(model_id)
                };
                if matched {
                    candidates.push(recommendation(model));
                }
            }
        }
        if !candidates.is_empty() {
            let result = modal_recommendation(&candidates);
            if result.is_some() || !matches!(tier, 1 | 2) {
                return result;
            }
        }
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
    fn matches_endpoint_limits_before_reference_fallback() {
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
            assert_eq!(
                lookup(&data, url, "same").unwrap().max_output_tokens,
                Some(200)
            );
        }
        assert_eq!(lookup(&data, "https://api.openai.com/v1", "same-new"), None);
    }

    #[test]
    fn proxy_and_plan_models_use_unambiguous_ids() {
        let data = json!({"zai":{"api":"https://api.z.ai/api/paas/v4","models":{"glm-5.3-flash":{"limit":{"context":1000,"output":200}}}},"router":{"api":"https://router.test/v1","models":{"z-ai/glm-5.3-flash":{"limit":{"context":1000,"output":200}}}}});
        for id in [
            "glm-5.3-flash",
            "z-ai/glm-5.3-flash",
            "custom/glm-5.3-flash",
        ] {
            for url in ["https://proxy.test/v1", "https://api.z.ai/api/anthropic"] {
                assert_eq!(
                    lookup(&data, url, id),
                    Some(ModelRecommendation {
                        context_window: Some(1000),
                        max_output_tokens: Some(200)
                    })
                );
            }
        }
        for id in ["glm-5.3", "glm-5.3-flashx", "glm-5.30-flash", ""] {
            assert_eq!(lookup(&data, "https://proxy.test/v1", id), None);
        }
    }

    #[test]
    fn endpoint_and_full_ids_win_before_leaf_reference_fallback() {
        let data = json!({"official":{"api":"https://official.test/v1","models":{"glm":{"limit":{"context":1000,"output":200}}}},"router":{"api":"https://router.test/v1","models":{"glm":{"limit":{"context":500,"output":100}},"z-ai/glm":{"limit":{"context":800,"output":80}}}}});
        assert_eq!(
            lookup(&data, "https://official.test/v1", "glm")
                .unwrap()
                .max_output_tokens,
            Some(200)
        );
        assert_eq!(
            lookup(&data, "https://proxy.test/v1", "z-ai/glm")
                .unwrap()
                .max_output_tokens,
            Some(80)
        );
        assert_eq!(
            lookup(&data, "https://proxy.test/v1", "glm")
                .unwrap()
                .max_output_tokens,
            Some(200)
        );
        assert_eq!(
            lookup(&data, "https://proxy.test/v1", "custom/glm")
                .unwrap()
                .max_output_tokens,
            Some(200)
        );
    }

    #[test]
    fn unusable_exact_candidates_stop_but_invalid_leaf_candidates_are_skipped() {
        let data = json!({"a":{"models":{"bad":{"limit":{"context":10,"output":20}}}},"b":{"models":{"vendor/bad":{"limit":{"context":100,"output":20}}}}});
        assert_eq!(lookup(&data, "https://proxy.test/v1", "bad"), None);
        assert_eq!(
            lookup(&data, "https://proxy.test/v1", "custom/bad")
                .unwrap()
                .max_output_tokens,
            Some(20)
        );
        assert_eq!(lookup(&data, "not a url", "vendor/bad"), None);
    }

    #[test]
    fn manufacturer_limits_win_for_qwen_but_endpoint_limits_still_take_precedence() {
        let mut data = json!({
            "alibaba":{"api":"https://dashscope-intl.aliyuncs.com/compatible-mode/v1","models":{"qwen3.8-flash":{"limit":{"context":1000000,"output":131072}}}},
            "alibaba-cn":{"api":"https://dashscope.aliyuncs.com/compatible-mode/v1","models":{"qwen3.8-flash":{"limit":{"context":1000000,"output":131072}}}},
            "hyper":{"api":"https://hyper.test/v1","models":{"qwen3.8-flash":{"limit":{"context":1000000,"output":128000}}}},
            "gateway-b":{"models":{"qwen3.8-flash":{"limit":{"context":1000000,"output":128000}}}},
            "gateway-c":{"models":{"qwen3.8-flash":{"limit":{"context":1000000,"output":128000}}}},
            "requesty":{"models":{"qwen3.8-flash":{"limit":{"context":1048576,"output":131072}}}},
            "router":{"api":"https://router.test/v1","models":{"qwen/qwen3.8-flash":{"limit":{"context":977000,"output":128000}}}}
        });
        let official = Some(ModelRecommendation {
            context_window: Some(1000000),
            max_output_tokens: Some(131072),
        });
        for id in [
            "qwen3.8-flash",
            "qwen/qwen3.8-flash",
            "custom/qwen3.8-flash",
        ] {
            assert_eq!(lookup(&data, "https://proxy.test/v1", id), official);
        }
        assert_eq!(
            lookup(&data, "https://hyper.test/v1", "qwen3.8-flash")
                .unwrap()
                .max_output_tokens,
            Some(128000)
        );
        assert_eq!(
            lookup(&data, "https://router.test/v1", "qwen/qwen3.8-flash")
                .unwrap()
                .context_window,
            Some(977000)
        );
        data["alibaba-cn"]["models"]["qwen3.8-flash"]["limit"]["output"] = json!(128000);
        assert_eq!(
            lookup(&data, "https://proxy.test/v1", "qwen3.8-flash"),
            official
        );
    }

    #[test]
    fn fallback_uses_the_most_common_complete_pair_and_first_candidate_on_ties() {
        let mut data = json!({
            "alibaba":{"name":"Original manufacturer","models":{"unknown-model":{"limit":{"context":900,"output":90}}}},
            "b":{"models":{"unknown-model":{"limit":{"context":1000,"output":100}}}},
            "c":{"models":{"unknown-model":{"limit":{"context":1000,"output":100}}}},
            "d":{"models":{"unknown-model":{"limit":{"context":1000,"output":90}}}}
        });
        assert_eq!(
            lookup(&data, "https://proxy.test/v1", "unknown-model"),
            Some(ModelRecommendation {
                context_window: Some(1000),
                max_output_tokens: Some(100)
            })
        );
        data["d"]["models"]["unknown-model"]["limit"] = json!({"context":900,"output":90});
        assert_eq!(
            lookup(&data, "https://proxy.test/v1", "unknown-model"),
            Some(ModelRecommendation {
                context_window: Some(900),
                max_output_tokens: Some(90)
            })
        );
        data.as_object_mut().unwrap().remove("c");
        data.as_object_mut().unwrap().remove("d");
        assert_eq!(
            lookup(&data, "https://proxy.test/v1", "unknown-model"),
            Some(ModelRecommendation {
                context_window: Some(900),
                max_output_tokens: Some(90)
            })
        );
    }

    #[test]
    fn modal_fallback_never_combines_independent_field_modes() {
        let mut data = json!({});
        for (index, (context, output)) in [
            (1000, 100),
            (1000, 200),
            (1000, 300),
            (2000, 400),
            (3000, 400),
            (4000, 400),
        ]
        .into_iter()
        .enumerate()
        {
            data[index.to_string()] =
                json!({"models":{"unknown-model":{"limit":{"context":context,"output":output}}}});
        }
        assert_eq!(
            lookup(&data, "https://proxy.test/v1", "unknown-model"),
            Some(ModelRecommendation {
                context_window: Some(1000),
                max_output_tokens: Some(100)
            })
        );
    }

    #[test]
    fn tied_fallback_uses_candidate_order_not_numeric_limit_order() {
        let mut data = json!({"a":{"models":{"m":{"limit":{"context":2000,"output":200}}}},"b":{"models":{"m":{"limit":{"context":1000,"output":100}}}}});
        assert_eq!(
            lookup(&data, "https://proxy.test/v1", "m")
                .unwrap()
                .context_window,
            Some(2000)
        );
        data["a"]["models"]["m"]["limit"] = json!({"context":10,"output":200});
        assert_eq!(
            lookup(&data, "https://proxy.test/v1", "m")
                .unwrap()
                .context_window,
            Some(1000)
        );
    }

    #[test]
    fn unreliable_manufacturer_allows_modal_fallback_but_invalid_endpoint_does_not() {
        let data = json!({
            "alibaba":{"api":"https://original.test/v1","models":{"qwen-test":{"limit":{"context":10,"output":20}}}},
            "b":{"models":{"qwen-test":{"limit":{"context":1000,"output":100}}}},
            "c":{"models":{"qwen-test":{"limit":{"context":1000,"output":100}}}}
        });
        assert_eq!(
            lookup(&data, "https://proxy.test/v1", "qwen-test")
                .unwrap()
                .max_output_tokens,
            Some(100)
        );
        assert_eq!(lookup(&data, "https://original.test/v1", "qwen-test"), None);
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
