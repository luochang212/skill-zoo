// src-tauri/src/persistence/metadata.rs

use crate::config;
use crate::error::AppError;
use crate::persistence::atomic_write;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// User metadata for a single skill — never rebuilt, only mutated by user actions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMetadata {
    pub starred: bool,
    pub is_mine: bool,
}

/// Persisted map of skill_id → user metadata.
/// Stored in ~/.skill-zoo/metadata.json, independent of the scan cache.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataStore {
    pub entries: HashMap<String, SkillMetadata>,
}

impl MetadataStore {
    pub fn load() -> Result<Self, AppError> {
        let path = config::get_app_config_dir().join("metadata.json");
        if !path.exists() {
            return Ok(Self {
                entries: HashMap::new(),
            });
        }
        let content = std::fs::read_to_string(&path).map_err(|e| crate::error::io(&path, e))?;
        serde_json::from_str(&content).map_err(|e| AppError::Parse(format!("metadata.json: {e}")))
    }

    pub fn save(&self) -> Result<(), AppError> {
        let path = config::get_app_config_dir().join("metadata.json");
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| crate::error::io(parent, e))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| AppError::Parse(format!("metadata.json: {e}")))?;
        atomic_write(&path, json).map_err(|e| crate::error::io(&path, e))
    }

    pub fn get(&self, skill_id: &str) -> SkillMetadata {
        self.entries
            .get(skill_id)
            .cloned()
            .unwrap_or(SkillMetadata {
                starred: false,
                is_mine: false,
            })
    }

    pub fn set_starred(&mut self, skill_id: &str, starred: bool) {
        let entry = self
            .entries
            .entry(skill_id.to_string())
            .or_insert(SkillMetadata {
                starred: false,
                is_mine: false,
            });
        entry.starred = starred;
    }

    pub fn set_is_mine(&mut self, skill_id: &str, is_mine: bool) {
        let entry = self
            .entries
            .entry(skill_id.to_string())
            .or_insert(SkillMetadata {
                starred: false,
                is_mine: false,
            });
        entry.is_mine = is_mine;
    }

    /// Remove metadata for a skill that no longer exists.
    pub fn remove(&mut self, skill_id: &str) {
        self.entries.remove(skill_id);
    }
}
