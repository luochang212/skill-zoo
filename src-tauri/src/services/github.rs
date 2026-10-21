use crate::error::AppError;
use regex::Regex;
use std::sync::LazyLock;

/// Only GitHub API consumers use this builder; archive and external requests
/// must never inherit the desktop token as a client-wide default header.
pub fn github_get(client: &reqwest::Client, url: &str) -> reqwest::RequestBuilder {
    github_get_with_token(client, url, crate::config::github_token().as_deref())
}

fn github_get_with_token(
    client: &reqwest::Client,
    url: &str,
    token: Option<&str>,
) -> reqwest::RequestBuilder {
    let request = client.get(url);
    match token.map(str::trim).filter(|v| !v.is_empty()) {
        Some(token) => request.bearer_auth(token),
        None => request,
    }
}

/// Classify API failures without treating generic proxy 403s as GitHub permissions.
pub fn response_error(response: &reqwest::Response, repo: &str) -> Option<AppError> {
    let status = response.status().as_u16();
    let headers = response.headers();
    let header = |name| headers.get(name).and_then(|value| value.to_str().ok());
    if status == 429 || (status == 403 && header("x-ratelimit-remaining") == Some("0")) {
        let now = chrono::Utc::now().timestamp();
        let usable_time = |timestamp: &i64| {
            *timestamp > now && chrono::DateTime::from_timestamp(*timestamp, 0).is_some()
        };
        let retry_at = header("retry-after")
            .and_then(|value| {
                value
                    .parse::<u32>()
                    .ok()
                    .map(|seconds| now + i64::from(seconds))
                    .or_else(|| {
                        chrono::DateTime::parse_from_rfc2822(value)
                            .ok()
                            .map(|date| date.timestamp())
                    })
            })
            .filter(usable_time)
            .or_else(|| {
                header("x-ratelimit-reset")
                    .and_then(|value| value.parse::<i64>().ok())
                    .filter(usable_time)
            });
        let authenticated = header("x-ratelimit-limit")
            .and_then(|value| value.parse::<u32>().ok())
            .map_or_else(
                || crate::config::github_token().is_some(),
                |limit| limit > 60,
            );
        return Some(AppError::RateLimited {
            repo: repo.into(),
            authenticated,
            retry_at,
        });
    }
    match status {
        200..=299 => None,
        401 => Some(AppError::GitHubUnauthorized(repo.into())),
        403 if headers.contains_key("x-accepted-github-permissions")
            || headers.contains_key("x-github-sso") =>
        {
            Some(AppError::GitHubPermissionDenied(repo.into()))
        }
        404 => Some(AppError::RepoNotFound(repo.into())),
        _ => Some(AppError::DownloadUnavailable(repo.into())),
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubTokenVerification {
    pub authenticated: bool,
    pub limit: u32,
    pub expires_at: Option<String>,
}

/// GitHub reports a PAT's expiry only via this response header (absent for
/// tokens without an expiry). Accepted forms: RFC 3339, or the documented
/// "YYYY-MM-DD HH:MM:SS UTC" rendering, normalized to RFC 3339 for the UI.
fn parse_token_expiration(value: &str) -> Option<String> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(value.trim()) {
        return Some(dt.to_rfc3339());
    }
    let without_zone = value.trim().strip_suffix(" UTC")?;
    let naive = chrono::NaiveDateTime::parse_from_str(without_zone, "%Y-%m-%d %H:%M:%S").ok()?;
    Some(naive.and_utc().to_rfc3339())
}

fn response_token_expiration(response: &reqwest::Response) -> Option<String> {
    response
        .headers()
        .get("github-authentication-token-expiration")?
        .to_str()
        .ok()
        .and_then(parse_token_expiration)
}

pub async fn verify_github_token(token: &str) -> Result<GitHubTokenVerification, String> {
    verify_github_token_at(
        crate::config::http_client(),
        "https://api.github.com/rate_limit",
        token,
    )
    .await
}

async fn verify_github_token_at(
    client: &reqwest::Client,
    url: &str,
    token: &str,
) -> Result<GitHubTokenVerification, String> {
    let response = github_get_with_token(client, url, Some(token))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| "Could not reach GitHub to verify token".to_string())?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Ok(GitHubTokenVerification {
            authenticated: false,
            limit: 0,
            expires_at: None,
        });
    }
    if response.status() != reqwest::StatusCode::OK {
        return Err(format!(
            "GitHub token verification returned HTTP {}",
            response.status().as_u16()
        ));
    }
    #[derive(serde::Deserialize)]
    struct RateLimit {
        resources: Resources,
    }
    #[derive(serde::Deserialize)]
    struct Resources {
        core: Core,
    }
    #[derive(serde::Deserialize)]
    struct Core {
        limit: u32,
    }
    // Read headers before `.json()` consumes the response.
    let expires_at = response_token_expiration(&response);
    let rate: RateLimit = response
        .json()
        .await
        .map_err(|_| "Invalid GitHub rate-limit response".to_string())?;
    let limit = rate.resources.core.limit;
    Ok(GitHubTokenVerification {
        authenticated: !token.trim().is_empty() && limit >= 5000,
        limit,
        expires_at,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubRepoRef {
    pub owner: String,
    pub name: String,
    pub branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubRepoQuery {
    pub owner: String,
    pub name: String,
    pub branch: Option<String>,
}

static REPO_SEGMENT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9_.-]+$").unwrap());

pub fn parse_repo_ref(input: &str) -> Result<GitHubRepoRef, AppError> {
    let query = parse_repo_query(input).map_err(AppError::BadRequest)?;
    Ok(GitHubRepoRef {
        owner: query.owner,
        name: query.name,
        branch: query.branch,
    })
}

pub fn parse_repo_query(input: &str) -> Result<GitHubRepoQuery, String> {
    let input = input.trim();

    if input.starts_with("http://") || input.starts_with("https://") {
        let url = url::Url::parse(input).map_err(|e| format!("Invalid URL: {e}"))?;
        match url.host_str() {
            Some("github.com") => {}
            Some(host) => return Err(format!("Expected github.com URL, got host: {host}")),
            None => return Err("Invalid GitHub URL: no host".into()),
        }

        let segments: Vec<&str> = url
            .path_segments()
            .ok_or("Invalid GitHub URL: no path segments")?
            .collect();

        if segments.len() < 2 {
            return Err("GitHub URL must include owner/name".into());
        }

        let owner = segments[0].to_string();
        let name = segments[1].trim_end_matches(".git").to_string();
        let branch = if segments.len() >= 4 && segments[2] == "tree" {
            Some(segments[3].to_string())
        } else {
            None
        };

        validate_repo_segments(&owner, &name, branch.as_deref().unwrap_or("HEAD"))?;
        Ok(GitHubRepoQuery {
            owner,
            name,
            branch,
        })
    } else {
        let parts: Vec<&str> = input.splitn(2, '/').collect();
        if parts.len() != 2 {
            return Err("Query must be in 'owner/name' format or a GitHub URL".into());
        }
        let owner = parts[0].to_string();
        let name = parts[1].trim_end_matches(".git").to_string();
        validate_repo_segments(&owner, &name, "HEAD")?;
        Ok(GitHubRepoQuery {
            owner,
            name,
            branch: None,
        })
    }
}

pub fn validate_repo_segments(owner: &str, name: &str, branch: &str) -> Result<(), String> {
    let id_re = &REPO_SEGMENT_RE;
    if !id_re.is_match(owner) || !id_re.is_match(name) {
        return Err("Invalid owner or repository name format".into());
    }
    if branch.contains('\0') || branch.contains("..") || branch.len() > 255 {
        return Err("Invalid branch name format".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{parse_repo_query, parse_repo_ref};

    #[test]
    fn github_api_requests_capture_current_token_for_all_endpoint_shapes() {
        crate::config::with_test_github_credentials(None, None, || {
            let client = reqwest::Client::new();
            for path in [
                "/repos/o/r/git/trees/HEAD?recursive=1",
                "/repos/o/r",
                "/repos/o/r/readme",
                "/repos/o/r/readme?ref=dev",
            ] {
                let url = format!("https://api.github.com{path}");
                assert!(!super::github_get(&client, &url)
                    .build()
                    .unwrap()
                    .headers()
                    .contains_key("authorization"));
                crate::config::set_github_credentials(Some("  saved-token  "), None);
                let request = super::github_get(&client, &url).build().unwrap();
                assert_eq!(request.headers()["authorization"], "Bearer saved-token");
                crate::config::set_github_credentials(None, None);
            }
            // The shared client must not authenticate unrelated downloads.
            crate::config::set_github_credentials(Some("saved-token"), None);
            assert!(!client
                .get("https://github.com/o/r/archive/HEAD.zip")
                .build()
                .unwrap()
                .headers()
                .contains_key("authorization"));
        });
    }

    #[test]
    fn expired_saved_token_falls_back_to_anonymous_requests() {
        crate::config::with_test_github_credentials(None, None, || {
            let client = reqwest::Client::new();
            let url = "https://api.github.com/repos/o/r";
            let authorization = |client: &reqwest::Client| {
                super::github_get(client, url)
                    .build()
                    .unwrap()
                    .headers()
                    .contains_key("authorization")
            };
            let future = (chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339();
            crate::config::set_github_credentials(Some("saved-token"), Some(&future));
            assert!(authorization(&client));
            let past = (chrono::Utc::now() - chrono::Duration::seconds(1)).to_rfc3339();
            crate::config::set_github_credentials(Some("saved-token"), Some(&past));
            assert!(!authorization(&client));
            // Unknown or unreadable expiry keeps failing loudly with the token attached.
            crate::config::set_github_credentials(Some("saved-token"), None);
            assert!(authorization(&client));
            crate::config::set_github_credentials(Some("saved-token"), Some("not a date"));
            assert!(authorization(&client));
        });
    }

    #[tokio::test]
    async fn candidate_verification_uses_candidate_and_checks_http_and_quota() {
        let mut server = mockito::Server::new_async().await;
        let client = reqwest::Client::new();
        for (status, body, expected) in [
            (
                200,
                r#"{"resources":{"core":{"limit":5000}}}"#,
                Some((true, 5000)),
            ),
            (
                200,
                r#"{"resources":{"core":{"limit":15000}}}"#,
                Some((true, 15000)),
            ),
            (
                200,
                r#"{"resources":{"core":{"limit":60}}}"#,
                Some((false, 60)),
            ),
            (401, "invalid", Some((false, 0))),
            (403, "forbidden", None),
            (500, "unavailable", None),
            (200, r#"{"resources":{}}"#, None),
            (200, "not JSON", None),
        ] {
            let mock = server
                .mock("GET", "/rate_limit")
                .match_header("authorization", "Bearer candidate-token")
                .with_status(status)
                .with_body(body)
                .create_async()
                .await;
            let result = super::verify_github_token_at(
                &client,
                &format!("{}/rate_limit", server.url()),
                " candidate-token \n",
            )
            .await;
            match expected {
                Some((authenticated, limit)) => {
                    let result = result.unwrap();
                    assert_eq!((result.authenticated, result.limit), (authenticated, limit));
                    assert_eq!(result.expires_at, None);
                }
                None => assert!(result.is_err()),
            }
            mock.assert_async().await;
            mock.remove_async().await;
        }
    }

    #[tokio::test]
    async fn candidate_verification_reports_token_expiration_header() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/rate_limit")
            .match_header("authorization", "Bearer candidate-token")
            .with_status(200)
            .with_header(
                "github-authentication-token-expiration",
                "2026-11-13 16:14:49 UTC",
            )
            .with_body(r#"{"resources":{"core":{"limit":5000}}}"#)
            .create_async()
            .await;
        let result = super::verify_github_token_at(
            &reqwest::Client::new(),
            &format!("{}/rate_limit", server.url()),
            "candidate-token",
        )
        .await
        .unwrap();
        assert_eq!(
            result.expires_at.as_deref(),
            Some("2026-11-13T16:14:49+00:00")
        );
        mock.assert_async().await;
    }

    #[test]
    fn token_expiration_parsing_accepts_documented_and_rfc3339_forms_only() {
        assert_eq!(
            super::parse_token_expiration("2026-11-13 16:14:49 UTC").as_deref(),
            Some("2026-11-13T16:14:49+00:00")
        );
        assert_eq!(
            super::parse_token_expiration("2026-11-13T16:14:49Z").as_deref(),
            Some("2026-11-13T16:14:49+00:00")
        );
        assert_eq!(super::parse_token_expiration("not a date"), None);
        assert_eq!(super::parse_token_expiration(""), None);
    }

    #[test]
    fn repo_ref_preserves_unknown_default_branch() {
        let repo_ref = parse_repo_ref("vercel-labs/skills").unwrap();

        assert_eq!(repo_ref.owner, "vercel-labs");
        assert_eq!(repo_ref.name, "skills");
        assert_eq!(repo_ref.branch, None);
    }

    #[test]
    fn repo_ref_parses_github_urls_and_tree_branch() {
        let repo_ref = parse_repo_ref("https://github.com/anthropics/skills/tree/dev").unwrap();

        assert_eq!(repo_ref.owner, "anthropics");
        assert_eq!(repo_ref.name, "skills");
        assert_eq!(repo_ref.branch.as_deref(), Some("dev"));
    }

    #[test]
    fn repo_ref_strips_dot_git() {
        let repo_ref = parse_repo_ref("https://github.com/anthropics/skills.git").unwrap();

        assert_eq!(repo_ref.owner, "anthropics");
        assert_eq!(repo_ref.name, "skills");
        assert_eq!(repo_ref.branch, None);
    }

    #[test]
    fn repo_query_only_returns_a_branch_when_explicitly_provided() {
        let query = parse_repo_query("owner/repo").unwrap();
        assert_eq!(query.owner, "owner");
        assert_eq!(query.name, "repo");
        assert_eq!(query.branch, None);

        let query = parse_repo_query("https://github.com/owner/repo/tree/master").unwrap();
        assert_eq!(query.owner, "owner");
        assert_eq!(query.name, "repo");
        assert_eq!(query.branch.as_deref(), Some("master"));
    }

    #[test]
    fn parser_rejects_non_github_hosts_and_invalid_segments() {
        assert!(parse_repo_ref("https://gitlab.com/foo/bar").is_err());
        assert!(parse_repo_query("bad owner/repo").is_err());
        assert!(parse_repo_query("owner/repo/tree/bad..branch").is_err());
    }
}

#[cfg(test)]
mod response_tests {
    use super::*;
    use crate::error::CommandError;

    #[tokio::test]
    async fn api_failures_preserve_recovery_details() {
        let mut server = mockito::Server::new_async().await;
        let reset = chrono::Utc::now().timestamp() + 3600;
        for (status, remaining, limit, permission, code) in [
            (401, "42", "5000", false, "githubUnauthorized"),
            (403, "0", "60", false, "rateLimited"),
            (403, "0", "5000", false, "rateLimited"),
            (429, "42", "5000", false, "rateLimited"),
            (403, "42", "5000", true, "githubPermissionDenied"),
            (403, "42", "5000", false, "downloadUnavailable"),
            (404, "42", "5000", false, "repoNotFound"),
            (500, "42", "5000", false, "downloadUnavailable"),
        ] {
            let mut mock = server
                .mock("GET", "/api")
                .with_status(status)
                .with_header("x-ratelimit-remaining", remaining)
                .with_header("x-ratelimit-limit", limit)
                .with_header("x-ratelimit-reset", &reset.to_string());
            if permission {
                mock = mock.with_header("x-accepted-github-permissions", "contents=read");
            }
            let mock = mock.create_async().await;
            let response = reqwest::get(format!("{}/api", server.url())).await.unwrap();
            let error = CommandError::from(response_error(&response, "o/r").unwrap());
            assert_eq!(error.code, code);
            let json = serde_json::to_value(&error).unwrap();
            assert_eq!(json["repo"], "o/r");
            if code == "rateLimited" {
                assert_eq!(json["authenticated"], limit == "5000");
                assert_eq!(json["retryAt"], reset);
            } else {
                assert!(json.get("authenticated").is_none());
                assert!(json.get("retryAt").is_none());
            }
            mock.assert_async().await;
            mock.remove_async().await;
        }
    }

    #[tokio::test]
    async fn retry_after_precedes_reset_and_invalid_times_are_omitted() {
        let mut server = mockito::Server::new_async().await;
        for retry in ["120", "invalid"] {
            let mock = server
                .mock("GET", "/api")
                .with_status(429)
                .with_header("retry-after", retry)
                .with_header("x-ratelimit-reset", "-1")
                .with_header("x-ratelimit-limit", "5000")
                .create_async()
                .await;
            let before = chrono::Utc::now().timestamp();
            let response = reqwest::get(format!("{}/api", server.url())).await.unwrap();
            let error = CommandError::from(response_error(&response, "o/r").unwrap());
            if retry == "120" {
                assert!(error.retry_at.unwrap() >= before + 120);
            } else {
                assert_eq!(error.retry_at, None);
            }
            mock.remove_async().await;
        }
    }
}
