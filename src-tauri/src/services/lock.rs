use crate::config;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillLockEntry {
    pub source: Option<String>,
    #[serde(default, rename = "sourceType")]
    pub source_type: Option<String>,
    #[serde(default, rename = "sourceUrl")]
    pub source_url: Option<String>,
    #[serde(default, rename = "ref")]
    pub branch: Option<String>,
    #[serde(default, rename = "skillPath")]
    pub skill_path: Option<String>,
    #[serde(default, rename = "skillFolderHash")]
    pub skill_folder_hash: Option<String>,
    #[serde(default, rename = "installedAt")]
    pub installed_at: Option<String>,
    #[serde(default, rename = "updatedAt")]
    pub updated_at: Option<String>,
    #[serde(default, rename = "commitSha")]
    pub commit_sha: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillLock {
    #[serde(default = "default_version")]
    pub version: i32,
    #[serde(default)]
    pub skills: BTreeMap<String, SkillLockEntry>,
    #[serde(default)]
    pub dismissed: serde_json::Value,
}

fn default_version() -> i32 {
    3
}

impl SkillLock {
    pub fn read() -> Result<Self, AppError> {
        let path = config::get_agent_lock_file();
        if !path.exists() {
            return Ok(Self {
                version: 3,
                skills: BTreeMap::new(),
                dismissed: serde_json::Value::Object(Default::default()),
            });
        }
        let content = std::fs::read_to_string(&path).map_err(|e| {
            AppError::Io(std::io::Error::other(format!(
                "Failed to read lock file {}: {e}",
                path.display()
            )))
        })?;
        serde_json::from_str(&content).map_err(|e| AppError::Parse(e.to_string()))
    }

    pub fn write(&self) -> Result<(), AppError> {
        let path = config::get_agent_lock_file();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(AppError::Io)?;
        }
        let content =
            serde_json::to_string_pretty(self).map_err(|e| AppError::Parse(e.to_string()))?;
        crate::persistence::atomic_write(&path, &content).map_err(AppError::Io)?;
        Ok(())
    }
}

impl SkillLock {
    pub fn update_commit_sha(skill_name: &str, sha: &str) -> Result<(), AppError> {
        let mut lock = Self::read()?;
        if let Some(entry) = lock.skills.get_mut(skill_name) {
            entry.commit_sha = Some(sha.to_string());
            lock.write()?;
        }
        Ok(())
    }
}

impl SkillLockEntry {
    /// Parse owner/name from the "source" field (e.g. "anthropics/skills").
    pub fn parse_source_owner_name(&self) -> (Option<String>, Option<String>) {
        let src = match &self.source {
            Some(s) => s.as_str(),
            None => return (None, None),
        };
        let parts: Vec<&str> = src.split('/').collect();
        (
            parts.first().map(|s| s.to_string()),
            parts.get(1).map(|s| s.to_string()),
        )
    }

    /// Get source_url if present; derive from source field as fallback.
    pub fn effective_url(&self) -> Option<String> {
        if let Some(url) = &self.source_url {
            if !url.is_empty() {
                return Some(url.clone());
            }
        }
        if let Some(src) = &self.source {
            if src.contains('/') && self.source_type.as_deref().unwrap_or("github") == "github" {
                return Some(format!("https://github.com/{src}"));
            }
        }
        None
    }
}
