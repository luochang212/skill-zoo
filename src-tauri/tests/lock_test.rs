mod common;

use common::{make_lock_entry, SkillLock};
use std::collections::BTreeMap;

#[test]
fn test_effective_url_derives_from_source() {
    let entry = make_lock_entry("anthropics/skills");
    let url = entry.effective_url();
    assert_eq!(
        url,
        Some("https://github.com/anthropics/skills".to_string())
    );
}

#[test]
fn test_effective_url_non_github_source_type() {
    let mut entry = make_lock_entry("anthropics/skills");
    entry.source_type = Some("gitlab".to_string());
    let url = entry.effective_url();
    assert_eq!(url, None);
}

#[test]
fn test_effective_url_empty_source_url_falls_back() {
    let mut entry = make_lock_entry("anthropics/skills");
    entry.source_url = Some("".to_string());
    let url = entry.effective_url();
    assert_eq!(
        url,
        Some("https://github.com/anthropics/skills".to_string())
    );
}

#[test]
fn test_refuses_to_write_future_lock_version() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let path = tmp.path().join("lock.json");
    let lock = SkillLock {
        version: 4,
        skills: BTreeMap::new(),
        dismissed: serde_json::json!({}),
    };

    let error = lock
        .write_to(&path)
        .expect_err("future version must not be written");

    assert!(error.to_string().contains("Lock file version 4 is newer"));
    assert!(!path.exists());
}
