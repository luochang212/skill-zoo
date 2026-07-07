mod common;

use common::{make_cache_entry, MetadataStore, SkillCache, SkillCacheEntry, SkillLock};

#[test]
fn test_metadata_load_returns_valid_store_when_no_file() {
    let store = MetadataStore::load().expect("load should succeed");
    let _ = store.get("any-key");
}

#[test]
fn test_skill_lock_read_returns_valid_lock_when_no_file() {
    let lock = SkillLock::read().expect("read should succeed");
    assert_eq!(lock.version, 3);
}

#[test]
fn test_skill_cache_builds_id_index_from_entries() {
    let cache = SkillCache::from_entries(vec![
        make_cache_entry("ssot:first", "first", "first"),
        make_cache_entry("ssot:second", "second", "second"),
    ]);

    assert_eq!(
        cache
            .find_by_id("ssot:second")
            .map(|entry| entry.name.as_str()),
        Some("second")
    );
    assert_eq!(cache.skills().len(), 2);
}

#[test]
fn test_skill_cache_deserialize_rebuilds_id_index() {
    let json = r#"{
        "skills": [
            {
                "id": "ssot:legacy",
                "name": "legacy",
                "yamlName": null,
                "description": null,
                "directory": "legacy",
                "repoOwner": null,
                "repoName": null,
                "sourceUrl": null,
                "origin": "ssot",
                "homePath": null,
                "contentHash": null,
                "homeAgent": null,
                "installedAt": 1000,
                "updatedAt": 2000
            }
        ]
    }"#;

    let cache: SkillCache = serde_json::from_str(json).expect("deserialize cache");

    assert!(cache.find_by_id("ssot:legacy").is_some());
    assert!(cache.find_by_id("missing").is_none());
}

#[test]
fn test_skill_cache_upsert_replaces_existing_id_without_duplicate() {
    let mut cache = SkillCache::from_entries(vec![make_cache_entry("ssot:demo", "old", "demo")]);
    let mut replacement = make_cache_entry("ssot:demo", "new", "demo");
    replacement.installed_at = 9999;
    replacement.updated_at = 3000;

    cache.upsert(replacement);

    assert_eq!(cache.skills().len(), 1);
    let entry = cache.find_by_id("ssot:demo").expect("entry");
    assert_eq!(entry.name, "new");
    assert_eq!(entry.installed_at, 1000);
    assert_eq!(entry.updated_at, 3000);
}

#[test]
fn test_skill_cache_remove_rebuilds_id_index() {
    let mut cache = SkillCache::from_entries(vec![
        make_cache_entry("ssot:first", "first", "first"),
        make_cache_entry("ssot:second", "second", "second"),
    ]);

    cache.remove("ssot:first");

    assert!(cache.find_by_id("ssot:first").is_none());
    assert_eq!(
        cache
            .find_by_id("ssot:second")
            .map(|entry| entry.name.as_str()),
        Some("second")
    );
}

#[test]
fn test_skill_cache_remove_where_rebuilds_id_index() {
    let mut cache = SkillCache::from_entries(vec![
        make_cache_entry("ssot:keep", "keep", "keep"),
        make_cache_entry("ssot:remove", "remove", "remove"),
    ]);

    cache.remove_where(|entry| entry.name == "remove");

    assert!(cache.find_by_id("ssot:remove").is_none());
    assert!(cache.find_by_id("ssot:keep").is_some());
}

#[test]
fn test_skill_cache_duplicate_id_index_points_to_last_entry() {
    let cache = SkillCache::from_entries(vec![
        make_cache_entry("ssot:demo", "first", "first"),
        make_cache_entry("ssot:demo", "second", "second"),
    ]);

    assert_eq!(
        cache
            .find_by_id("ssot:demo")
            .map(|entry| entry.name.as_str()),
        Some("second")
    );
}

#[test]
fn test_skill_cache_upsert_dedup_by_home_path() {
    let entry_a = SkillCacheEntry {
        id: "ssot:demo".to_string(),
        name: "demo".to_string(),
        directory: "demo".to_string(),
        home_path: Some("/tmp/demo".to_string()),
        installed_at: 1000,
        updated_at: 2000,
        ..make_cache_entry("ssot:demo", "demo", "demo")
    };
    let mut cache = SkillCache::from_entries(vec![entry_a]);

    let entry_b = SkillCacheEntry {
        id: "repo:owner/demo:demo".to_string(),
        name: "demo".to_string(),
        directory: "demo".to_string(),
        repo_owner: Some("owner".to_string()),
        repo_name: Some("demo".to_string()),
        home_path: Some("/tmp/demo".to_string()),
        installed_at: 9999,
        updated_at: 3000,
        ..make_cache_entry("repo:owner/demo:demo", "demo", "demo")
    };
    cache.upsert(entry_b);

    assert_eq!(cache.skills().len(), 1);
    let entry = cache.find_by_id("repo:owner/demo:demo").expect("entry");
    assert_eq!(entry.name, "demo");
    // installed_at preserved from stale entry
    assert_eq!(entry.installed_at, 1000);
    assert_eq!(entry.updated_at, 3000);
    // stale id should no longer be in the index
    assert!(cache.find_by_id("ssot:demo").is_none());
}

#[test]
fn test_skill_cache_upsert_dedup_by_directory_fallback() {
    let entry_a = SkillCacheEntry {
        id: "ssot:demo".to_string(),
        name: "demo".to_string(),
        directory: "demo".to_string(),
        home_path: None,
        ..make_cache_entry("ssot:demo", "demo", "demo")
    };
    let mut cache = SkillCache::from_entries(vec![entry_a]);

    let entry_b = SkillCacheEntry {
        id: "repo:owner/demo:demo".to_string(),
        name: "demo".to_string(),
        directory: "demo".to_string(),
        home_path: None,
        ..make_cache_entry("repo:owner/demo:demo", "demo", "demo")
    };
    cache.upsert(entry_b);

    assert_eq!(cache.skills().len(), 1, "directory fallback must dedup");
}

#[test]
fn test_skill_cache_upsert_normalizes_home_path_to_forward_slashes() {
    // On Windows the incoming home_path may have native backslash separators.
    // upsert() must normalize it to forward slashes before storing in cache.
    let entry = SkillCacheEntry {
        id: "ssot:demo".to_string(),
        name: "demo".to_string(),
        directory: "demo".to_string(),
        home_path: Some("C:\\Users\\demo\\.claude\\skills\\demo".to_string()),
        installed_at: 1000,
        updated_at: 2000,
        ..make_cache_entry("ssot:demo", "demo", "demo")
    };
    let mut cache = SkillCache::from_entries(vec![]);
    cache.upsert(entry);

    assert_eq!(cache.skills().len(), 1);
    let stored = cache.find_by_id("ssot:demo").expect("entry");
    assert_eq!(
        stored.home_path.as_deref(),
        Some("C:/Users/demo/.claude/skills/demo"),
        "home_path must be normalized to forward slashes"
    );
}
