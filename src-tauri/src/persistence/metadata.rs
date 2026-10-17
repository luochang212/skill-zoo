// src-tauri/src/persistence/metadata.rs

use crate::config;
use crate::error::AppError;
use crate::persistence::atomic_write;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// User metadata for a single skill — never rebuilt, only mutated by user actions.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillMetadata {
    pub starred: bool,
    pub is_mine: bool,
}

/// Persisted map of stable metadata key → user metadata.
/// Stored in ~/.skill-zoo/metadata.json, independent of the scan cache.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataStore {
    #[serde(default)]
    pub version: u32,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
    pub entries: HashMap<String, SkillMetadata>,
}

impl MetadataStore {
    pub fn load() -> Result<Self, AppError> {
        let path = config::get_app_config_dir().join("metadata.json");
        let store = Self::load_from(&path)?;
        if store.version != 0 {
            return Ok(store);
        }
        let _lease = super::agent_transaction::AgentLease::acquire(&config::get_app_config_dir())?;
        Self::load_under_lease()
    }

    /// Caller holds the shared mutation lease. Always re-read before a mutation.
    pub fn load_under_lease() -> Result<Self, AppError> {
        let path = config::get_app_config_dir().join("metadata.json");
        let mut store = Self::load_from(&path)?;
        if store.version == 0 {
            let imports = super::ExternalImports::load()?;
            store.migrate(
                &config::get_agents_skills_dir(),
                &imports
                    .imports
                    .iter()
                    .flat_map(|(key, entry)| [key.clone(), entry.id.clone()])
                    .collect(),
            );
            store.save()?;
        }
        store.assert_writable()?;
        Ok(store)
    }

    pub fn empty() -> Self {
        Self {
            version: 1,
            extra: HashMap::new(),
            entries: HashMap::new(),
        }
    }

    pub fn load_from(path: &Path) -> Result<Self, AppError> {
        if !path.exists() {
            return Ok(Self::empty());
        }
        let content = std::fs::read_to_string(path).map_err(|e| crate::error::io(path, e))?;
        if content.trim().is_empty() {
            return Ok(Self::empty());
        }
        serde_json::from_str(&content).map_err(|e| AppError::Parse(format!("metadata.json: {e}")))
    }

    pub fn save(&self) -> Result<(), AppError> {
        self.assert_writable()?;
        if self.version != 1 {
            return Err(AppError::BadRequest(
                "Migrate legacy metadata before writing".into(),
            ));
        }
        let path = config::get_app_config_dir().join("metadata.json");
        Self::load_from(&path)?.assert_writable()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| crate::error::io(parent, e))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| AppError::Parse(format!("metadata.json: {e}")))?;
        atomic_write(&path, json).map_err(|e| crate::error::io(&path, e))
    }

    pub fn assert_writable(&self) -> Result<(), AppError> {
        if self.version > 1 {
            return Err(AppError::BadRequest(format!(
                "Metadata version {} is newer than supported. Upgrade Skill Zoo before writing.",
                self.version
            )));
        }
        Ok(())
    }

    /// One-time migration uses only historical directory evidence, never the cache.
    /// Unbound records remain in entries; they are not fallback lookup aliases.
    pub fn migrate(
        &mut self,
        root: &Path,
        protected: &std::collections::HashSet<String>,
    ) -> Vec<String> {
        if self.version != 0 {
            return self.unbound_keys(protected);
        }
        let mut groups: HashMap<String, Vec<String>> = HashMap::new();
        for id in self.entries.keys() {
            if protected.contains(id) {
                continue;
            }
            let Some(rest) = id.strip_prefix("repo:") else {
                continue;
            };
            let Some((source, directory)) = rest.split_once(':') else {
                continue;
            };
            let parts: Vec<_> = source.split('/').collect();
            if parts.len() != 2 || parts.iter().any(|p| p.is_empty()) {
                continue;
            }
            let Ok(key) = metadata_key("ssot", directory, id) else {
                continue;
            };
            if protected.contains(&key) {
                continue;
            }
            let candidate = root.join(directory);
            if !candidate.join("SKILL.md").is_file() {
                continue;
            }
            let (Ok(real_root), Ok(real_candidate)) =
                (root.canonicalize(), candidate.canonicalize())
            else {
                continue;
            };
            if !real_candidate.starts_with(real_root) {
                continue;
            }
            groups.entry(key).or_default().push(id.clone());
        }
        for (target, ids) in groups {
            let value = self.entries[&ids[0]].clone();
            if ids.iter().any(|id| self.entries[id] != value)
                || self.entries.get(&target).is_some_and(|v| *v != value)
            {
                continue;
            }
            self.entries.insert(target, value);
            for id in ids {
                self.entries.remove(&id);
            }
        }
        self.version = 1;
        let pending = self.unbound_keys(protected);
        for id in &pending {
            eprintln!(
                "Unbound user metadata: {id}; see docs/local-protocol.md for manual resolution"
            );
        }
        pending
    }

    pub fn unbound_keys(&self, protected: &std::collections::HashSet<String>) -> Vec<String> {
        let mut keys: Vec<_> = self
            .entries
            .keys()
            .filter(|id| {
                !protected.contains(*id)
                    && !id.starts_with("agent:")
                    && !id.starts_with("external:")
                    && id
                        .strip_prefix("ssot:")
                        .is_none_or(|directory| metadata_key("ssot", directory, id).is_err())
            })
            .cloned()
            .collect();
        keys.sort();
        keys
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

/// SSOT metadata addresses an installation slot; all other origins retain their ID.
pub fn metadata_key(origin: &str, directory: &str, id: &str) -> Result<String, AppError> {
    if origin != "ssot" {
        return Ok(id.to_string());
    }
    // Reject ambiguous or escaping inputs instead of reducing them to a leaf name.
    if directory.is_empty()
        || directory.contains(['\\', ':'])
        || directory
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return Err(AppError::BadRequest(format!(
            "Invalid SSOT metadata directory: {directory}"
        )));
    }
    Ok(format!("ssot:{directory}"))
}

pub fn entry_key(entry: &super::SkillCacheEntry) -> Result<String, AppError> {
    metadata_key(&entry.origin, &entry.directory, &entry.id)
}

#[cfg(test)]
mod tests {
    use super::MetadataStore;

    #[test]
    fn empty_metadata_file_loads_as_empty_store() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("metadata.json");
        std::fs::write(&path, " \n\t").expect("write empty metadata");

        let store = MetadataStore::load_from(&path).expect("load metadata");

        assert!(store.entries.is_empty());
    }
}

#[cfg(all(test, feature = "test-helpers"))]
mod identity_tests {
    use super::*;
    use crate::persistence::SkillCache;
    use crate::services::{lock::SkillLock, skill::SkillService};
    use serde_json::Value;
    use std::collections::HashSet;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../fixtures/local-protocol")
                .join(name),
        )
        .unwrap()
    }
    fn skill(root: &Path, directory: &str) {
        let dir = root.join(directory);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("SKILL.md"),
            "---\nname: demo\ndescription: test\n---\nbody",
        )
        .unwrap();
    }

    #[test]
    fn shared_migration_fixtures_are_conservative_and_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        for dir in ["demo", ".system/nested", "retained", "target", "equal"] {
            skill(tmp.path(), dir);
        }
        let protected = HashSet::from(["repo:old/repo:retained".into()]);
        let mut store: MetadataStore =
            serde_json::from_str(&fixture("metadata-v0-legacy.json")).unwrap();
        store.migrate(tmp.path(), &protected);
        assert!(store.get("ssot:demo").starred && store.get("ssot:demo").is_mine);
        assert!(store.get("ssot:.system/nested").starred);
        assert!(store.entries.contains_key("repo:old/repo:retained"));
        assert!(store.entries.contains_key("repo:old/repo:missing"));
        let once = serde_json::to_value(&store).unwrap();
        store.migrate(tmp.path(), &protected);
        assert_eq!(serde_json::to_value(&store).unwrap(), once);
        let mut conflicts: MetadataStore =
            serde_json::from_str(&fixture("metadata-v1-migration-conflicts.json")).unwrap();
        let before = conflicts.entries.clone();
        let pending = conflicts.migrate(tmp.path(), &HashSet::new());
        assert!(pending.contains(&"repo:unparseable".to_string()));
        assert!(pending.contains(&"unrecognized-history".to_string()));
        for id in [
            "repo:one/repo:demo",
            "repo:two/repo:demo",
            "ssot:target",
            "repo:owner/repo:target",
            "repo:unparseable",
        ] {
            assert_eq!(conflicts.entries[id], before[id]);
        }
        assert!(!conflicts.entries.contains_key("ssot:demo"));
        assert!(conflicts.get("ssot:equal").is_mine);
        assert!(!conflicts.entries.contains_key("repo:one/repo:equal"));
        for name in ["metadata-v1-minimal.json", "metadata-v1-full.json"] {
            let mut current: MetadataStore = serde_json::from_str(&fixture(name)).unwrap();
            let before = serde_json::to_value(&current).unwrap();
            current.migrate(tmp.path(), &protected);
            assert_eq!(serde_json::to_value(current).unwrap(), before);
        }
        let future: MetadataStore =
            serde_json::from_str(&fixture("metadata-v2-future.json")).unwrap();
        assert!(future.assert_writable().is_err());
        assert!(serde_json::from_str::<MetadataStore>(
            r#"{"entries":{"ssot:demo":{"starred":true,"isMine":false,"unknown":1}}}"#
        )
        .is_err());
        for directory in ["../demo", "/demo", "a//b", "a/./b", "a\\b", "a:b"] {
            assert!(metadata_key("ssot", directory, "old").is_err());
        }
    }

    #[test]
    fn production_scans_keep_flags_through_source_churn_and_restart_without_cache() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let root = config::get_agents_skills_dir();
            skill(&root, "demo");
            let metadata_path = config::get_app_config_dir().join("metadata.json");
            std::fs::create_dir_all(metadata_path.parent().unwrap()).unwrap();
            std::fs::write(&metadata_path, fixture("metadata-v0-legacy.json")).unwrap();
            let cases: Vec<Value> =
                serde_json::from_str(&fixture("source-identity-cases.json")).unwrap();
            for case in cases {
                let source = case["source"].as_str();
                let lock_path = tmp.path().join(".agents/.skill-lock.json");
                std::fs::write(&lock_path, serde_json::to_vec(&serde_json::json!({"version":3,"skills":{"demo":{"source":source}},"dismissed":{}})).unwrap()).unwrap();
                let parsed = SkillLock::read().unwrap();
                let (owner, repo) = parsed.skills["demo"].parse_source_owner_name();
                assert_eq!(
                    owner.zip(repo).map(|(o, r)| format!("{o}/{r}")),
                    case["repo"].as_str().map(str::to_string)
                );
                let single = SkillService::scan_single_skill("demo").unwrap();
                let full = SkillService::scan_skill_root_for_test(&root.join("demo"), &root, None)
                    .unwrap();
                assert_eq!(single.id, full.id);
                let metadata = MetadataStore::load().unwrap();
                let result = SkillService::get_cached_skills(
                    &SkillCache::from_entries(vec![full]),
                    &metadata,
                )
                .unwrap();
                assert!(result[0].starred && result[0].is_mine, "source {source:?}");
            }
            std::fs::remove_file(tmp.path().join(".agents/.skill-lock.json")).unwrap();
            let entry = SkillService::scan_single_skill("demo").unwrap();
            assert_eq!(entry.id, "ssot:demo");
            let result = SkillService::get_cached_skills(
                &SkillCache::from_entries(vec![entry]),
                &MetadataStore::load().unwrap(),
            )
            .unwrap();
            assert!(result[0].starred && result[0].is_mine);
            let before = fixture("metadata-v2-future.json");
            std::fs::write(&metadata_path, &before).unwrap();
            assert!(MetadataStore::empty().save().is_err());
            assert_eq!(std::fs::read_to_string(metadata_path).unwrap(), before);
        });
    }
}
