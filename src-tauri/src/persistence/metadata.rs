// src-tauri/src/persistence/metadata.rs

use crate::config;
use crate::error::AppError;
use crate::persistence::atomic_write;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// User metadata for a single skill. It is never rebuilt, only mutated by user actions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

/// Map a legacy provenance-derived skill ID to the canonical installation
/// directory identity. `repo:{owner}/{repo}:{dir}` → `ssot:{dir}`; owner/repo
/// cannot contain `:`, so the first `:` after the prefix preserves the full directory.
/// Any other ID form is already canonical and returns None.
pub fn canonicalize_legacy_skill_id(skill_id: &str) -> Option<String> {
    let rest = skill_id.strip_prefix("repo:")?;
    let (_owner_repo, dir) = rest.split_once(':')?;
    Some(format!("ssot:{dir}"))
}

impl MetadataStore {
    pub fn load() -> Result<Self, AppError> {
        let path = config::get_app_config_dir().join("metadata.json");
        Self::load_from(&path)
    }

    fn empty() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    /// Load from an explicit path. Applies the legacy-key migration and
    /// persists the converged state. Public so protocol fixtures can load
    /// arbitrary metadata files directly.
    pub fn load_from(path: &Path) -> Result<Self, AppError> {
        if !path.exists() {
            return Ok(Self::empty());
        }
        let content = std::fs::read_to_string(path).map_err(|e| crate::error::io(path, e))?;
        if content.trim().is_empty() {
            return Ok(Self::empty());
        }
        let mut store: MetadataStore = serde_json::from_str(&content)
            .map_err(|e| AppError::Parse(format!("metadata.json: {e}")))?;
        if store.migrate_legacy_keys() {
            if let Err(e) = store.save_to(path) {
                // Converge on disk when possible, but never block loading on
                // it: the in-memory state is already migrated.
                eprintln!("metadata.json: legacy key migration save failed: {e}");
            }
        }
        Ok(store)
    }

    /// Rekey legacy provenance-derived IDs to the canonical installation
    /// directory identity (`repo:{owner}/{repo}:{dir}` → `ssot:{dir}`),
    /// OR-merging into existing canonical entries. Returns true when the
    /// entries changed, so the caller can persist the converged state.
    fn migrate_legacy_keys(&mut self) -> bool {
        let pairs: Vec<(String, String)> = self
            .entries
            .keys()
            .filter_map(|key| {
                canonicalize_legacy_skill_id(key).map(|canonical| (key.clone(), canonical))
            })
            .collect();
        let mut changed = false;
        for (legacy_key, canonical) in pairs {
            let entry = self
                .entries
                .remove(&legacy_key)
                .expect("legacy key present");
            changed = true;
            match self.entries.get_mut(&canonical) {
                Some(existing) => {
                    existing.starred = existing.starred || entry.starred;
                    existing.is_mine = existing.is_mine || entry.is_mine;
                }
                None => {
                    self.entries.insert(canonical, entry);
                }
            }
        }
        changed
    }

    fn save_to(&self, path: &Path) -> Result<(), AppError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| crate::error::io(parent, e))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| AppError::Parse(format!("metadata.json: {e}")))?;
        atomic_write(path, json).map_err(|e| crate::error::io(path, e))
    }

    pub fn save(&self) -> Result<(), AppError> {
        let path = config::get_app_config_dir().join("metadata.json");
        self.save_to(&path)
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

#[cfg(test)]
mod tests {
    use super::{canonicalize_legacy_skill_id, MetadataStore};

    #[test]
    fn empty_metadata_file_loads_as_empty_store() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("metadata.json");
        std::fs::write(&path, " \n\t").expect("write empty metadata");

        let store = MetadataStore::load_from(&path).expect("load metadata");

        assert!(store.entries.is_empty());
    }

    #[test]
    fn canonicalize_maps_only_legacy_repo_ids() {
        assert_eq!(
            canonicalize_legacy_skill_id("repo:owner/repo:demo"),
            Some("ssot:demo".to_string())
        );
        // Nested directories survive: owner/repo cannot contain ':'.
        assert_eq!(
            canonicalize_legacy_skill_id("repo:owner/re.go:category/nested"),
            Some("ssot:category/nested".to_string())
        );
        assert_eq!(
            canonicalize_legacy_skill_id("repo:owner/repo:foo:bar"),
            Some("ssot:foo:bar".to_string())
        );
        assert_eq!(canonicalize_legacy_skill_id("ssot:demo"), None);
        assert_eq!(canonicalize_legacy_skill_id("agent:codex:/a/demo"), None);
        assert_eq!(canonicalize_legacy_skill_id("external:demo"), None);
    }

    #[test]
    fn load_migrates_legacy_repo_keys_and_persists() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("metadata.json");
        std::fs::write(
            &path,
            r#"{
                "entries": {
                    "repo:owner/repo:demo": {"starred": true, "isMine": false},
                    "ssot:other": {"starred": false, "isMine": true},
                    "agent:codex:/a/demo": {"starred": true, "isMine": true}
                }
            }"#,
        )
        .expect("write legacy metadata");

        let store = MetadataStore::load_from(&path).expect("load metadata");

        assert_eq!(store.get("ssot:demo").starred, true);
        assert_eq!(store.get("ssot:other").is_mine, true);
        assert_eq!(store.get("agent:codex:/a/demo").starred, true);
        assert!(!store.entries.contains_key("repo:owner/repo:demo"));

        // Convergence: the migrated state is persisted verbatim.
        let reloaded = MetadataStore::load_from(&path).expect("reload metadata");
        assert_eq!(reloaded.entries, store.entries);
    }

    #[test]
    fn load_merges_legacy_key_into_existing_canonical_entry() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("metadata.json");
        std::fs::write(
            &path,
            r#"{
                "entries": {
                    "repo:owner/repo:demo": {"starred": true, "isMine": false},
                    "ssot:demo": {"starred": false, "isMine": true}
                }
            }"#,
        )
        .expect("write legacy metadata");

        let store = MetadataStore::load_from(&path).expect("load metadata");

        let merged = store.get("ssot:demo");
        assert!(merged.starred);
        assert!(merged.is_mine);
        assert_eq!(store.entries.len(), 1);
    }

    #[test]
    fn load_without_legacy_keys_writes_nothing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("metadata.json");
        let original = r#"{"entries": {"ssot:demo": {"starred": true, "isMine": false}}}"#;
        std::fs::write(&path, original).expect("write metadata");
        let mtime_before = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .expect("mtime");

        let store = MetadataStore::load_from(&path).expect("load metadata");

        let mtime_after = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .expect("mtime");
        assert_eq!(mtime_before, mtime_after, "no rewrite without legacy keys");
        assert_eq!(store.entries.len(), 1);
    }

    #[test]
    fn load_returns_migrated_metadata_when_persistence_fails() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("metadata.json");
        let original = r#"{"entries":{"repo:owner/repo:demo":{"starred":true,"isMine":true}}}"#;
        std::fs::write(&path, original).expect("write metadata");
        // Block the atomic writer's temp file without relying on OS permissions.
        std::fs::create_dir(dir.path().join("metadata.json.tmp")).expect("block write");

        let store = MetadataStore::load_from(&path).expect("load despite write failure");

        assert!(store.get("ssot:demo").starred);
        assert!(store.get("ssot:demo").is_mine);
        assert!(!store.entries.contains_key("repo:owner/repo:demo"));
        assert_eq!(
            std::fs::read_to_string(&path).expect("read metadata"),
            original
        );
    }
}
