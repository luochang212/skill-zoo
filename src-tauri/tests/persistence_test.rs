mod common;

use common::{MetadataStore, SkillLock};

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
