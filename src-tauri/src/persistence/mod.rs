pub mod archive;
pub mod metadata;

pub use archive::{ArchiveManifest, ArchivedSkill};
pub use metadata::MetadataStore;

use crate::config;
use crate::error::{self, AppError};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::HashMap;
use std::path::Path;

/// Write `data` to `path` atomically: write to a temp file first, then rename.
/// On same-filesystem rename is atomic, so a crash never leaves a half-written file.
pub(crate) fn atomic_write(path: &Path, data: impl AsRef<[u8]>) -> std::io::Result<()> {
    let tmp_name = format!("{}.tmp", path.file_name().unwrap().to_str().unwrap());
    let tmp_path = path.with_file_name(&tmp_name);
    {
        let mut f = std::fs::File::create(&tmp_path)?;
        std::io::Write::write_all(&mut f, data.as_ref())?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp_path, path)
}

/// A single entry in the skills cache — filesystem scan result without user metadata.
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
    #[serde(default)]
    pub apps: HashMap<String, bool>,
    pub installed_at: i64,
    pub updated_at: i64,
}

/// JSON snapshot of filesystem scan results. User metadata (starred, is_mine) is stored separately in MetadataStore.
#[derive(Debug, Clone)]
pub struct SkillCache {
    skills: Vec<SkillCacheEntry>,
    by_id: HashMap<String, usize>,
}

impl SkillCache {
    pub fn empty() -> Self {
        Self::from_entries(Vec::new())
    }

    pub fn from_entries(skills: Vec<SkillCacheEntry>) -> Self {
        let mut cache = Self {
            skills,
            by_id: HashMap::new(),
        };
        cache.rebuild_index();
        cache
    }

    pub fn load() -> Result<Self, AppError> {
        let path = config::get_app_config_dir().join("skills-cache.json");
        if !path.exists() {
            return Ok(Self::empty());
        }
        let content = std::fs::read_to_string(&path).map_err(|e| error::io(&path, e))?;
        serde_json::from_str(&content)
            .map_err(|e| AppError::Parse(format!("skills-cache.json: {e}")))
    }

    pub fn skills(&self) -> &[SkillCacheEntry] {
        &self.skills
    }

    pub fn iter(&self) -> std::slice::Iter<'_, SkillCacheEntry> {
        self.skills.iter()
    }

    pub fn is_empty(&self) -> bool {
        self.skills.is_empty()
    }

    pub fn find_by_id(&self, id: &str) -> Option<&SkillCacheEntry> {
        self.by_id.get(id).and_then(|index| self.skills.get(*index))
    }

    pub fn replace_all(&mut self, skills: Vec<SkillCacheEntry>) {
        self.skills = skills;
        self.rebuild_index();
    }

    pub fn upsert(&mut self, entry: SkillCacheEntry) {
        if let Some(index) = self.by_id.get(&entry.id).copied() {
            let installed_at = self.skills[index].installed_at;
            self.skills[index] = entry;
            self.skills[index].installed_at = installed_at;
            return;
        }
        let index = self.skills.len();
        self.by_id.insert(entry.id.clone(), index);
        self.skills.push(entry);
    }

    pub fn remove(&mut self, id: &str) {
        self.skills.retain(|entry| entry.id != id);
        self.rebuild_index();
    }

    pub fn remove_where(&mut self, mut predicate: impl FnMut(&SkillCacheEntry) -> bool) {
        self.skills.retain(|entry| !predicate(entry));
        self.rebuild_index();
    }

    pub fn save(&self) -> Result<(), AppError> {
        let path = config::get_app_config_dir().join("skills-cache.json");
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| error::io(parent, e))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| AppError::Parse(format!("skills-cache.json: {e}")))?;
        atomic_write(&path, json).map_err(|e| error::io(&path, e))
    }

    fn rebuild_index(&mut self) {
        self.by_id.clear();
        for (index, entry) in self.skills.iter().enumerate() {
            self.by_id.insert(entry.id.clone(), index);
        }
    }
}

impl Serialize for SkillCache {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        struct SkillCacheDisk<'a> {
            skills: &'a [SkillCacheEntry],
        }

        SkillCacheDisk {
            skills: &self.skills,
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for SkillCache {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct SkillCacheDisk {
            #[serde(default)]
            skills: Vec<SkillCacheEntry>,
        }

        let disk = SkillCacheDisk::deserialize(deserializer)?;
        Ok(Self::from_entries(disk.skills))
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
