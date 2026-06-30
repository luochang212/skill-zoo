use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("CLI error: {0}")]
    Cli(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Parse error: {0}")]
    Parse(String),

    #[error("Rate limited: {0}")]
    RateLimited(String),

    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("Download failed for {repo}: {source}")]
    DownloadNetwork {
        repo: String,
        source: reqwest::Error,
    },

    #[error("Download timed out for {repo}: {source}")]
    DownloadTimeout {
        repo: String,
        source: reqwest::Error,
    },

    #[error("DNS lookup failed for {repo}: {source}")]
    DownloadDns {
        repo: String,
        source: reqwest::Error,
    },

    #[error("Could not connect to GitHub for {repo}: {source}")]
    DownloadConnect {
        repo: String,
        source: reqwest::Error,
    },

    #[error("TLS / certificate error connecting to GitHub for {repo}: {source}")]
    DownloadTls {
        repo: String,
        source: reqwest::Error,
    },

    #[error("Download temporarily unavailable: {0}")]
    DownloadUnavailable(String),

    #[error("Repository not found: {0}")]
    RepoNotFound(String),

    #[error("Repository archive for {repo} exceeds {max_mb}MB")]
    RepoTooLarge { repo: String, max_mb: u64 },

    #[error("Zip error: {0}")]
    Zip(String),
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
    pub repo: Option<String>,
}

impl From<AppError> for CommandError {
    fn from(error: AppError) -> Self {
        let code = error.code();
        let repo = error.repo();
        let message = error.to_string();
        Self {
            code,
            message,
            repo,
        }
    }
}

impl CommandError {
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self {
            code: "badRequest",
            message: message.into(),
            repo: None,
        }
    }

    pub fn generic(message: impl Into<String>) -> Self {
        Self {
            code: "generic",
            message: message.into(),
            repo: None,
        }
    }
}

impl AppError {
    fn code(&self) -> &'static str {
        match self {
            AppError::DownloadNetwork { .. } | AppError::Network(_) => "downloadNetwork",
            AppError::DownloadTimeout { .. } => "downloadTimeout",
            AppError::DownloadDns { .. } => "downloadDns",
            AppError::DownloadConnect { .. } => "downloadConnect",
            AppError::DownloadTls { .. } => "downloadTls",
            AppError::DownloadUnavailable(_) => "downloadUnavailable",
            AppError::RepoNotFound(_) => "repoNotFound",
            AppError::RateLimited(_) => "rateLimited",
            AppError::RepoTooLarge { .. } => "repoTooLarge",
            AppError::Io(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                "permissionDenied"
            }
            AppError::Io(error) if error.raw_os_error() == Some(28) => "diskFull",
            AppError::NotFound(_) => "notFound",
            AppError::BadRequest(_) => "badRequest",
            _ => "generic",
        }
    }

    fn repo(&self) -> Option<String> {
        match self {
            AppError::DownloadNetwork { repo, .. }
            | AppError::DownloadTimeout { repo, .. }
            | AppError::DownloadDns { repo, .. }
            | AppError::DownloadConnect { repo, .. }
            | AppError::DownloadTls { repo, .. }
            | AppError::DownloadUnavailable(repo)
            | AppError::RepoNotFound(repo)
            | AppError::RateLimited(repo) => Some(repo.clone()),
            AppError::RepoTooLarge { repo, .. } => Some(repo.clone()),
            _ => None,
        }
    }
}

pub fn classify_download_error(repo: String, error: reqwest::Error) -> AppError {
    eprintln!("download error for {repo}: {error}");
    eprintln!(
        "  is_timeout={} is_connect={} is_request={} is_body={} status={:?}",
        error.is_timeout(),
        error.is_connect(),
        error.is_request(),
        error.is_body(),
        error.status()
    );

    if error.is_timeout() {
        return AppError::DownloadTimeout {
            repo,
            source: error,
        };
    }

    let msg = error.to_string().to_lowercase();

    if error.is_connect() {
        // macOS DNS: "nodename nor servname provided, or not known"
        // Linux glibc DNS: "Temporary failure in name resolution"
        // Linux glibc DNS: "Name or service not known"
        // BSD/macOS DNS: "No address associated with hostname"
        // Windows DNS: "No such host is known"
        let is_dns = msg.contains("dns")
            || msg.contains("name resolution")
            || msg.contains("nodename nor servname")
            || msg.contains("no address associated with hostname")
            || msg.contains("no such host is known")
            || msg.contains("temporary failure in name")
            || msg.contains("name or service not known");

        if is_dns {
            return AppError::DownloadDns {
                repo,
                source: error,
            };
        }

        // When is_request() is also true, hyper combined the connect + request
        // error. Check remaining keywords only against the connect-only case
        // to avoid misclassifying HTTP-level errors as DNS.
        if !error.is_request() {
            if msg.contains("resolve")
                || msg.contains("lookup")
                || msg.contains("unreachable")
                || msg.contains("not found")
                || msg.contains("no address")
            {
                return AppError::DownloadDns {
                    repo,
                    source: error,
                };
            }
        }

        // TLS errors — distinct from plain "can't connect"
        if msg.contains("tls")
            || msg.contains("ssl")
            || msg.contains("certificate")
            || msg.contains("handshake")
            || msg.contains("UnknownIssuer")
            || msg.contains("CertExpired")
            || msg.contains("HostnameMismatch")
        {
            return AppError::DownloadTls {
                repo,
                source: error,
            };
        }

        return AppError::DownloadConnect {
            repo,
            source: error,
        };
    }

    // We have an error after the connection was established.
    // Check for TLS issues in the response phase too (e.g. incomplete handshake).
    if msg.contains("tls")
        || msg.contains("ssl")
        || msg.contains("certificate")
        || msg.contains("handshake")
    {
        return AppError::DownloadTls {
            repo,
            source: error,
        };
    }

    // Preserve HTTP status when available — it helps distinguish
    // "connected but body transfer failed" from other network errors.
    if let Some(status) = error.status() {
        eprintln!("  http_status={}", status.as_u16());
        return AppError::DownloadNetwork {
            repo,
            source: error,
        };
    }

    AppError::DownloadNetwork {
        repo,
        source: error,
    }
}

pub fn io(path: &std::path::Path, e: std::io::Error) -> AppError {
    AppError::Io(std::io::Error::new(
        e.kind(),
        format!("{}: {}", path.display(), e),
    ))
}

impl From<zip::result::ZipError> for AppError {
    fn from(e: zip::result::ZipError) -> Self {
        AppError::Zip(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{classify_download_error, AppError, CommandError};

    #[test]
    fn command_error_preserves_download_repo_and_code() {
        let error = AppError::RepoNotFound("owner/repo".to_string());
        let command_error = CommandError::from(error);

        assert_eq!(command_error.code, "repoNotFound");
        assert_eq!(command_error.repo.as_deref(), Some("owner/repo"));
    }

    #[test]
    fn command_error_classifies_repo_too_large() {
        let error = AppError::RepoTooLarge {
            repo: "owner/repo".to_string(),
            max_mb: 100,
        };
        let command_error = CommandError::from(error);

        assert_eq!(command_error.code, "repoTooLarge");
        assert_eq!(command_error.repo.as_deref(), Some("owner/repo"));
    }

    #[test]
    fn command_error_classifies_download_unavailable_separately_from_rate_limit() {
        let error = AppError::DownloadUnavailable("owner/repo".to_string());
        let command_error = CommandError::from(error);

        assert_eq!(command_error.code, "downloadUnavailable");
        assert_eq!(command_error.repo.as_deref(), Some("owner/repo"));
    }

    #[test]
    fn command_error_maps_dns_connect_tls_variants() {
        // Verify the DNS, connect, and TLS AppError variants map to expected codes.
        let source = reqwest::Client::new()
            .get("not a valid url")
            .build()
            .unwrap_err();

        let dns_error = AppError::DownloadDns {
            repo: "test/repo".into(),
            source,
        };
        let dns_cmd = CommandError::from(dns_error);
        assert_eq!(dns_cmd.code, "downloadDns");
        assert_eq!(dns_cmd.repo.as_deref(), Some("test/repo"));

        let source2 = reqwest::Client::new()
            .get("also invalid")
            .build()
            .unwrap_err();
        let connect_error = AppError::DownloadConnect {
            repo: "test/repo".into(),
            source: source2,
        };
        let connect_cmd = CommandError::from(connect_error);
        assert_eq!(connect_cmd.code, "downloadConnect");
        assert_eq!(connect_cmd.repo.as_deref(), Some("test/repo"));

        let source3 = reqwest::Client::new()
            .get("nope again")
            .build()
            .unwrap_err();
        let tls_error = AppError::DownloadTls {
            repo: "test/repo".into(),
            source: source3,
        };
        let tls_cmd = CommandError::from(tls_error);
        assert_eq!(tls_cmd.code, "downloadTls");
        assert_eq!(tls_cmd.repo.as_deref(), Some("test/repo"));
    }

    #[tokio::test]
    async fn classify_download_error_handles_connect_failure() {
        // Trigger a real connection failure against a guaranteed non-existent domain.
        let error = reqwest::Client::new()
            .get("https://this-domain-definitely-does-not-exist.invalid")
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
            .unwrap_err();
        assert!(error.is_connect());

        let app_error = classify_download_error("test/repo".into(), error);
        let command_error = CommandError::from(app_error);

        assert_eq!(command_error.repo.as_deref(), Some("test/repo"));
        // Hyper wraps DNS errors in a combined connect+request error.
        // When the OS-level DNS message isn't preserved, we classify as
        // downloadConnect (general connectivity issue) rather than downloadDns.
        assert!(
            command_error.code == "downloadDns" || command_error.code == "downloadConnect",
            "unexpected code: {}",
            command_error.code
        );
    }
}
