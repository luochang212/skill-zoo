mod common;

use common::make_lock_entry;

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
