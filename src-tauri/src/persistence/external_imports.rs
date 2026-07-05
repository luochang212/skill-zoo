use crate::config;
use crate::error::{self, AppError};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

pub const SUPPORTED_EXTERNAL_IMPORTS_VERSION: i32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalImportEntry {
    pub id: String,
    pub source_path: String,
    pub directory: String,
    pub imported_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalImports {
    #[serde(default = "default_version")]
    pub version: i32,
    #[serde(default)]
    pub imports: BTreeMap<String, ExternalImportEntry>,
}

fn default_version() -> i32 {
    SUPPORTED_EXTERNAL_IMPORTS_VERSION
}

impl Default for ExternalImports {
    fn default() -> Self {
        Self {
            version: SUPPORTED_EXTERNAL_IMPORTS_VERSION,
            imports: BTreeMap::new(),
        }
    }
}

impl ExternalImports {
    pub fn load() -> Result<Self, AppError> {
        Self::load_from(&config::get_external_imports_file())
    }

    pub fn load_from(path: &Path) -> Result<Self, AppError> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = std::fs::read_to_string(path).map_err(|e| error::io(path, e))?;
        if content.trim().is_empty() {
            return Ok(Self::default());
        }
        serde_json::from_str(&content).map_err(|e| AppError::Parse(format!("imports.json: {e}")))
    }

    pub fn save(&self) -> Result<(), AppError> {
        self.save_to(&config::get_external_imports_file())
    }

    pub fn save_to(&self, path: &Path) -> Result<(), AppError> {
        if self.version > SUPPORTED_EXTERNAL_IMPORTS_VERSION {
            return Err(AppError::BadRequest(format!(
                "External imports version {} is newer than this desktop app supports. Upgrade Skill Zoo before writing.",
                self.version
            )));
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| error::io(parent, e))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| AppError::Parse(format!("imports.json: {e}")))?;
        crate::persistence::atomic_write(path, json).map_err(|e| error::io(path, e))
    }
}
