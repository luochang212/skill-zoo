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

    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("Zip error: {0}")]
    Zip(String),
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
