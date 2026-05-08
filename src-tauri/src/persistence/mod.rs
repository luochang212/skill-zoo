pub mod metadata;

pub use metadata::MetadataStore;

use crate::config;
use crate::error::{self, AppError};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Write `data` to `path` atomically: write to a temp file first, then rename.
/// On same-filesystem rename is atomic, so a crash never leaves a half-written file.
pub(crate) fn atomic_write(path: &Path, data: impl AsRef<[u8]>) -> std::io::Result<()> {
    let tmp_path = path.with_extension("json.tmp");
    {
        let mut f = std::fs::File::create(&tmp_path)?;
        std::io::Write::write_all(&mut f, data.as_ref())?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp_path, path)
}

/// A single entry in the skills cache — filesystem scan result without user metadata or live `apps`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCacheEntry {
    pub id: String,
    pub name: String,
    pub yaml_name: Option<String>,
    pub description: Option<String>,
    pub directory: String,
    pub repo_owner: Option<String>,
    pub repo_name: Option<String>,
    pub source_url: Option<String>,
    pub origin: String,
    pub home_path: Option<String>,
    pub content_hash: Option<String>,
    pub home_agent: Option<String>,
    pub installed_at: i64,
    pub updated_at: i64,
}

/// JSON snapshot of filesystem scan results. User metadata (starred, is_mine) is stored separately in MetadataStore.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillCache {
    pub skills: Vec<SkillCacheEntry>,
}

impl SkillCache {
    pub fn save(&self) -> Result<(), AppError> {
        let path = config::get_app_config_dir().join("skills-cache.json");
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| error::io(parent, e))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| AppError::Parse(format!("skills-cache.json: {e}")))?;
        atomic_write(&path, json).map_err(|e| error::io(&path, e))
    }
}

/// Key-value settings. Replaces the `settings` SQLite table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub values: HashMap<String, String>,
}

impl Settings {
    pub fn load() -> Result<Self, AppError> {
        let path = config::get_app_config_dir().join("settings.json");
        if !path.exists() {
            return Ok(Self {
                values: HashMap::new(),
            });
        }
        let content = std::fs::read_to_string(&path).map_err(|e| error::io(&path, e))?;
        serde_json::from_str(&content).map_err(|e| AppError::Parse(format!("settings.json: {e}")))
    }

    pub fn save(&self) -> Result<(), AppError> {
        let path = config::get_app_config_dir().join("settings.json");
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| error::io(parent, e))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| AppError::Parse(format!("settings.json: {e}")))?;
        atomic_write(&path, json).map_err(|e| error::io(&path, e))
    }

    pub fn get(&self, key: &str) -> Option<&String> {
        self.values.get(key)
    }

    pub fn set(&mut self, key: String, value: String) {
        self.values.insert(key, value);
    }
}
