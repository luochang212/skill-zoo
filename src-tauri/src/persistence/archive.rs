use crate::config;
use crate::error::{self, AppError};
use crate::persistence::atomic_write;
use crate::services::lock::SkillLockEntry;
use crate::services::skill::InstalledSkill;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedSkill {
    pub id: String,
    pub archive_id: String,
    pub original_skill_id: String,
    pub name: String,
    pub yaml_name: Option<String>,
    pub description: Option<String>,
    pub directory: String,
    pub repo_owner: Option<String>,
    pub repo_name: Option<String>,
    pub source_url: Option<String>,
    pub apps: HashMap<String, bool>,
    pub origin: String,
    pub home_path: Option<String>,
    pub content_hash: Option<String>,
    pub home_agent: Option<String>,
    pub starred: bool,
    pub is_mine: bool,
    pub installed_at: i64,
    pub updated_at: i64,
    pub archived_at: i64,
    pub lock_key: Option<String>,
    pub lock_entry: Option<SkillLockEntry>,
    pub archived_by_version: Option<String>,
    pub reason: Option<String>,
}

impl ArchivedSkill {
    pub fn from_installed(
        skill: InstalledSkill,
        archive_id: String,
        lock_key: Option<String>,
        lock_entry: Option<SkillLockEntry>,
    ) -> Self {
        Self {
            id: archive_id.clone(),
            archive_id,
            original_skill_id: skill.id,
            name: skill.name,
            yaml_name: skill.yaml_name,
            description: skill.description,
            directory: skill.directory,
            repo_owner: skill.repo_owner,
            repo_name: skill.repo_name,
            source_url: skill.source_url,
            apps: skill.apps,
            origin: skill.origin,
            home_path: skill.home_path,
            content_hash: skill.content_hash,
            home_agent: skill.home_agent,
            starred: skill.starred,
            is_mine: skill.is_mine,
            installed_at: skill.installed_at,
            updated_at: skill.updated_at,
            archived_at: chrono::Utc::now().timestamp(),
            lock_key,
            lock_entry,
            archived_by_version: Some(env!("CARGO_PKG_VERSION").to_string()),
            reason: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveManifest {
    #[serde(default = "default_version")]
    pub version: i32,
    #[serde(default)]
    pub skills: BTreeMap<String, ArchivedSkill>,
}

fn default_version() -> i32 {
    1
}

impl Default for ArchiveManifest {
    fn default() -> Self {
        Self {
            version: default_version(),
            skills: BTreeMap::new(),
        }
    }
}

impl ArchiveManifest {
    pub fn load() -> Result<Self, AppError> {
        Self::load_from(&config::get_archive_manifest_file())
    }

    pub fn load_from(path: &Path) -> Result<Self, AppError> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = std::fs::read_to_string(path).map_err(|e| error::io(path, e))?;
        serde_json::from_str(&content)
            .map_err(|e| AppError::Parse(format!("archive manifest: {e}")))
    }

    pub fn save(&self) -> Result<(), AppError> {
        Self::save_to(self, &config::get_archive_manifest_file())
    }

    pub fn save_to(&self, path: &Path) -> Result<(), AppError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| error::io(parent, e))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| AppError::Parse(format!("archive manifest: {e}")))?;
        atomic_write(path, json).map_err(|e| error::io(path, e))
    }

    pub fn archive_skill_dir(archive_id: &str) -> PathBuf {
        config::get_archive_skills_dir().join(archive_id)
    }

    pub fn make_archive_id(skill_id: &str, directory: &str) -> String {
        use sha2::{Digest, Sha256};

        let mut hasher = Sha256::new();
        hasher.update(skill_id.as_bytes());
        let hash = hasher.finalize();
        let short_hash: String = hash[..8].iter().map(|b| format!("{:02x}", b)).collect();
        let safe_name: String = directory
            .rsplit('/')
            .next()
            .unwrap_or(directory)
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                    c
                } else {
                    '-'
                }
            })
            .collect();

        let prefix = if safe_name.is_empty() {
            "skill".to_string()
        } else {
            safe_name
        };
        format!("{prefix}-{short_hash}")
    }
}
