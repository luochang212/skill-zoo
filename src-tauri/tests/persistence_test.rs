mod common;

use common::{MetadataStore, SkillLock, SkillLockEntry};

#[test]
fn test_metadata_roundtrip() {
    // Use a unique key to avoid collision with other tests
    let unique_key = format!("test-roundtrip-{}", std::process::id());

    let mut store = MetadataStore::load().expect("load should succeed");
    store.set_starred(&unique_key, true);

    // Save
    store.save().expect("save should succeed");

    // Load
    let loaded = MetadataStore::load().expect("load should succeed");
    assert!(loaded.get(&unique_key).starred);

    // Clean up
    let mut store = MetadataStore::load().expect("load should succeed");
    store.remove(&unique_key);
    store.save().expect("cleanup save should succeed");
}

#[test]
fn test_skill_lock_roundtrip() {
    let unique_key = format!("test-skill-{}", std::process::id());

    let mut lock = SkillLock::read().expect("read should succeed");
    lock.skills.insert(
        unique_key.clone(),
        SkillLockEntry {
            source: Some("anthropics/skills".to_string()),
            source_type: Some("github".to_string()),
            source_url: None,
            branch: Some("main".to_string()),
            skill_path: None,
            skill_folder_hash: None,
            installed_at: Some("2024-01-01T00:00:00Z".to_string()),
            updated_at: Some("2024-01-01T00:00:00Z".to_string()),
        },
    );

    lock.write().expect("write should succeed");

    let loaded = SkillLock::read().expect("read should succeed");
    assert!(loaded.skills.contains_key(&unique_key));
    let entry = &loaded.skills[&unique_key];
    assert_eq!(entry.source, Some("anthropics/skills".to_string()));

    // Clean up
    let mut lock = SkillLock::read().expect("read should succeed");
    lock.skills.remove(&unique_key);
    lock.write().expect("cleanup write should succeed");
}

#[test]
fn test_metadata_load_returns_valid_store() {
    // MetadataStore::load should always return a valid store,
    // whether the file exists or not
    let store = MetadataStore::load().expect("load should succeed");
    // Just verify it's a valid store with the right type
    let _ = store.get("any-key");
}

#[test]
fn test_skill_lock_read_returns_valid_lock() {
    // SkillLock::read should always return a valid lock,
    // whether the file exists or not
    let lock = SkillLock::read().expect("read should succeed");
    assert_eq!(lock.version, 3);
}
