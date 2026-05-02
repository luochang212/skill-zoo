mod common;

use common::make_lock_entry;

#[test]
fn test_parse_source_owner_name_normal() {
    let entry = make_lock_entry("anthropics/skills");
    let (owner, name) = entry.parse_source_owner_name();
    assert_eq!(owner, Some("anthropics".to_string()));
    assert_eq!(name, Some("skills".to_string()));
}

#[test]
fn test_parse_source_owner_name_no_slash() {
    let mut entry = make_lock_entry("single-part");
    entry.source = Some("single-part".to_string());
    let (owner, name) = entry.parse_source_owner_name();
    assert_eq!(owner, Some("single-part".to_string()));
    assert_eq!(name, None);
}

#[test]
fn test_parse_source_owner_name_none_source() {
    let mut entry = make_lock_entry("x/y");
    entry.source = None;
    let (owner, name) = entry.parse_source_owner_name();
    assert_eq!(owner, None);
    assert_eq!(name, None);
}

#[test]
fn test_effective_url_with_source_url() {
    let mut entry = make_lock_entry("anthropics/skills");
    entry.source_url = Some("https://github.com/anthropics/skills".to_string());
    let url = entry.effective_url();
    assert_eq!(url, Some("https://github.com/anthropics/skills".to_string()));
}

#[test]
fn test_effective_url_derives_from_source() {
    let entry = make_lock_entry("anthropics/skills");
    // No source_url set, but source has slash and type is github
    let url = entry.effective_url();
    assert_eq!(url, Some("https://github.com/anthropics/skills".to_string()));
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
    // Empty source_url should fall back to derived URL
    assert_eq!(url, Some("https://github.com/anthropics/skills".to_string()));
}

#[test]
fn test_effective_url_no_source() {
    let mut entry = make_lock_entry("x/y");
    entry.source = None;
    let url = entry.effective_url();
    assert_eq!(url, None);
}
