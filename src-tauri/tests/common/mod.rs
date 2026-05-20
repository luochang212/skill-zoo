#[allow(unused_imports)]
pub use skill_zoo_lib::persistence::metadata::MetadataStore;
#[allow(unused_imports)]
pub use skill_zoo_lib::persistence::{SkillCache, SkillCacheEntry};
#[allow(unused_imports)]
pub use skill_zoo_lib::services::lock::{SkillLock, SkillLockEntry};
#[allow(unused_imports)]
pub use skill_zoo_lib::services::skill::SkillService;

/// Build a test SkillCacheEntry with sensible defaults.
#[allow(dead_code)]
pub fn make_cache_entry(id: &str, name: &str, directory: &str) -> SkillCacheEntry {
    SkillCacheEntry {
        id: id.to_string(),
        name: name.to_string(),
        yaml_name: None,
        description: None,
        directory: directory.to_string(),
        repo_owner: None,
        repo_name: None,
        source_url: None,
        origin: "ssot".to_string(),
        home_path: None,
        content_hash: None,
        home_agent: None,
        installed_at: 1000,
        updated_at: 2000,
    }
}

/// Build a test SkillLockEntry with sensible defaults.
#[allow(dead_code)]
pub fn make_lock_entry(source: &str) -> SkillLockEntry {
    SkillLockEntry {
        source: Some(source.to_string()),
        source_type: Some("github".to_string()),
        source_url: None,
        branch: Some("main".to_string()),
        skill_path: None,
        skill_folder_hash: None,
        installed_at: Some("2024-01-01T00:00:00Z".to_string()),
        updated_at: Some("2024-01-01T00:00:00Z".to_string()),
        commit_sha: None,
    }
}
