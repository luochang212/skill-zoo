use crate::config;
use crate::error::{self, AppError};
use crate::persistence::atomic_write;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

pub const SUPPORTED_UPDATE_HISTORY_VERSION: i32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillUpdateHistoryRecord {
    pub id: String,
    pub started_at: String,
    pub finished_at: String,
    pub mode: String,
    pub requested_skills: Vec<String>,
    pub updated_skills: Vec<String>,
    pub failed_skills: Vec<String>,
    pub errors: Vec<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillUpdateHistory {
    #[serde(default = "default_version")]
    pub version: i32,
    #[serde(default)]
    pub records: BTreeMap<String, SkillUpdateHistoryRecord>,
}

fn default_version() -> i32 {
    SUPPORTED_UPDATE_HISTORY_VERSION
}

impl Default for SkillUpdateHistory {
    fn default() -> Self {
        Self {
            version: default_version(),
            records: BTreeMap::new(),
        }
    }
}

impl SkillUpdateHistory {
    pub fn load() -> Result<Self, AppError> {
        Self::load_from(&config::get_update_history_file())
    }

    pub fn load_from(path: &Path) -> Result<Self, AppError> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = std::fs::read_to_string(path).map_err(|e| error::io(path, e))?;
        serde_json::from_str(&content)
            .map_err(|e| AppError::Parse(format!("skill update history: {e}")))
    }

    pub fn save(&self) -> Result<(), AppError> {
        Self::save_to(self, &config::get_update_history_file())
    }

    pub fn save_to(&self, path: &Path) -> Result<(), AppError> {
        if self.version > SUPPORTED_UPDATE_HISTORY_VERSION {
            return Err(AppError::BadRequest(format!(
                "Skill update history version {} is newer than this desktop app supports. Upgrade Skill Zoo before writing.",
                self.version
            )));
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| error::io(parent, e))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| AppError::Parse(format!("skill update history: {e}")))?;
        atomic_write(path, json).map_err(|e| error::io(path, e))
    }

    pub fn sorted_records(&self) -> Vec<SkillUpdateHistoryRecord> {
        let mut records: Vec<_> = self.records.values().cloned().collect();
        records.sort_by(|a, b| b.finished_at.cmp(&a.finished_at));
        records
    }

    pub fn insert(&mut self, record: SkillUpdateHistoryRecord) {
        self.records.insert(record.id.clone(), record);
    }

    pub fn remove(&mut self, id: &str) -> bool {
        self.records.remove(id).is_some()
    }

    pub fn clear(&mut self) {
        self.records.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::{SkillUpdateHistory, SkillUpdateHistoryRecord};

    fn record(id: &str, finished_at: &str) -> SkillUpdateHistoryRecord {
        SkillUpdateHistoryRecord {
            id: id.to_string(),
            started_at: finished_at.to_string(),
            finished_at: finished_at.to_string(),
            mode: "selected".to_string(),
            requested_skills: vec!["demo".to_string()],
            updated_skills: vec!["demo".to_string()],
            failed_skills: vec![],
            errors: vec![],
            status: "success".to_string(),
        }
    }

    #[test]
    fn persists_sorts_deletes_and_clears_history_records() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("history.json");
        let mut history = SkillUpdateHistory::default();
        history.insert(record("old", "2024-01-01T00:00:00Z"));
        history.insert(record("new", "2024-01-02T00:00:00Z"));
        history.save_to(&path).expect("save history");

        let mut loaded = SkillUpdateHistory::load_from(&path).expect("load history");
        let sorted = loaded.sorted_records();
        assert_eq!(sorted[0].id, "new");
        assert_eq!(sorted[1].id, "old");

        assert!(loaded.remove("old"));
        loaded.save_to(&path).expect("save deleted history");
        let loaded = SkillUpdateHistory::load_from(&path).expect("reload history");
        assert_eq!(loaded.sorted_records().len(), 1);

        let mut loaded = loaded;
        loaded.clear();
        loaded.save_to(&path).expect("save cleared history");
        let loaded = SkillUpdateHistory::load_from(&path).expect("reload cleared history");
        assert!(loaded.sorted_records().is_empty());
    }
}
