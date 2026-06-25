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
            | AppError::DownloadUnavailable(repo)
            | AppError::RepoNotFound(repo)
            | AppError::RateLimited(repo) => Some(repo.clone()),
            AppError::RepoTooLarge { repo, .. } => Some(repo.clone()),
            _ => None,
        }
    }
}

pub fn classify_download_error(repo: String, error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::DownloadTimeout {
            repo,
            source: error,
        }
    } else {
        AppError::DownloadNetwork {
            repo,
            source: error,
        }
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
    use super::{AppError, CommandError};

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
}
