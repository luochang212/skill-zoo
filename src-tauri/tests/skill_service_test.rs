mod common;

use common::{
    make_cache_entry, make_lock_entry, MetadataStore, SkillCache, SkillCacheEntry, SkillLock,
    SkillService,
};
use skill_zoo_lib::services::skill::DiscoverableSkillInstallStatus;
use std::collections::HashMap;
use std::sync::RwLock;

#[test]
fn test_extract_frontmatter_no_closing_delimiter() {
    let md = "---\nname: test\n\n# Hello";
    let result = SkillService::extract_frontmatter(md);
    assert_eq!(result, None);
}

#[test]
fn test_extract_frontmatter_empty_frontmatter() {
    let md = "---\n---\n\n# Hello";
    let result = SkillService::extract_frontmatter(md);
    assert_eq!(result, Some("".to_string()));
}

#[test]
fn test_parse_skill_md_extracts_name_from_frontmatter() {
    let dir = tempfile::tempdir().expect("tempdir");
    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir(&skill_dir).expect("create dir");
    let md = "---\nname: Custom Name\ndescription: A helpful skill\n---\n\n# Body";
    std::fs::write(skill_dir.join("SKILL.md"), md).expect("write");

    let (name, desc) = SkillService::parse_skill_md(&skill_dir.join("SKILL.md")).expect("parse");
    assert_eq!(name, "Custom Name");
    assert_eq!(desc.as_deref(), Some("A helpful skill"));
}

#[test]
fn test_parse_skill_md_falls_back_to_dir_name_when_no_frontmatter() {
    let dir = tempfile::tempdir().expect("tempdir");
    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir(&skill_dir).expect("create dir");
    let md = "# No frontmatter here";
    std::fs::write(skill_dir.join("SKILL.md"), md).expect("write");

    let (name, desc) = SkillService::parse_skill_md(&skill_dir.join("SKILL.md")).expect("parse");
    assert_eq!(name, "my-skill");
    assert_eq!(desc, None);
}

#[test]
fn test_skill_cache_entry_defaults_missing_apps() {
    let json = r#"{
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
    }"#;

    let entry: SkillCacheEntry = serde_json::from_str(json).expect("deserialize legacy entry");

    assert!(entry.apps.is_empty());
}

#[test]
fn test_read_all_skills_uses_cached_apps() {
    let mut entry = make_cache_entry("ssot:cached", "cached", "cached");
    entry.apps = HashMap::from([
        ("codex".to_string(), true),
        ("claude-code".to_string(), false),
    ]);
    let cache = RwLock::new(SkillCache::from_entries(vec![entry]));
    let metadata = RwLock::new(MetadataStore {
        entries: HashMap::new(),
    });

    let skills = SkillService::read_all_skills(&cache, &metadata).expect("read cached skills");

    assert_eq!(skills[0].apps.get("codex"), Some(&true));
    assert_eq!(skills[0].apps.get("claude-code"), Some(&false));
}

#[test]
fn test_classify_discoverable_skill_distinguishes_installed_and_conflict() {
    let mut installed = make_cache_entry("repo:owner/repo:demo", "demo", "demo");
    installed.repo_owner = Some("owner".to_string());
    installed.repo_name = Some("repo".to_string());
    let cache = SkillCache::from_entries(vec![installed]);
    let mut lock = SkillLock {
        version: 3,
        skills: Default::default(),
        dismissed: serde_json::json!({}),
    };
    lock.skills
        .insert("demo".to_string(), make_lock_entry("owner/repo"));

    assert_eq!(
        SkillService::classify_discoverable_skill(
            &cache,
            &lock,
            "demo",
            "owner",
            "repo",
            Some("main"),
        ),
        (
            DiscoverableSkillInstallStatus::Installed,
            Some("repo:owner/repo:demo".to_string()),
        )
    );
    assert_eq!(
        SkillService::classify_discoverable_skill(
            &cache,
            &lock,
            "demo",
            "OWNER",
            "REPO",
            Some("main"),
        ),
        (
            DiscoverableSkillInstallStatus::Installed,
            Some("repo:owner/repo:demo".to_string()),
        )
    );
    assert_eq!(
        SkillService::classify_discoverable_skill(
            &cache,
            &lock,
            "demo",
            "other",
            "repo",
            Some("main"),
        ),
        (DiscoverableSkillInstallStatus::Conflict, None)
    );
    assert_eq!(
        SkillService::classify_discoverable_skill(
            &cache,
            &lock,
            "demo",
            "owner",
            "repo",
            Some("other-branch"),
        ),
        (DiscoverableSkillInstallStatus::Conflict, None)
    );
}

#[test]
fn test_classify_discoverable_skill_treats_multiple_same_directory_entries_as_conflict() {
    let cache = SkillCache::from_entries(vec![
        make_cache_entry("ssot:demo", "demo", "demo"),
        make_cache_entry("agent:codex:demo", "demo", "demo"),
    ]);
    let lock = SkillLock {
        version: 3,
        skills: Default::default(),
        dismissed: serde_json::json!({}),
    };

    assert_eq!(
        SkillService::classify_discoverable_skill(&cache, &lock, "demo", "owner", "repo", None,),
        (DiscoverableSkillInstallStatus::Conflict, None)
    );
}

#[test]
fn test_classify_discoverable_skill_treats_missing_and_local_entries_conservatively() {
    let lock = SkillLock {
        version: 3,
        skills: Default::default(),
        dismissed: serde_json::json!({}),
    };
    assert_eq!(
        SkillService::classify_discoverable_skill(
            &SkillCache::empty(),
            &lock,
            "demo",
            "owner",
            "repo",
            Some("main"),
        ),
        (DiscoverableSkillInstallStatus::Available, None)
    );

    let mut local = make_cache_entry("agent:codex:demo", "demo", "demo");
    local.origin = "agent".to_string();
    local.repo_owner = Some("owner".to_string());
    local.repo_name = Some("repo".to_string());
    assert_eq!(
        SkillService::classify_discoverable_skill(
            &SkillCache::from_entries(vec![local]),
            &lock,
            "demo",
            "owner",
            "repo",
            None,
        ),
        (DiscoverableSkillInstallStatus::Conflict, None)
    );
}

#[test]
fn test_build_file_tree_level_does_not_recurse() {
    let dir = tempfile::tempdir().expect("tempdir");
    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir(&skill_dir).expect("create skill dir");
    std::fs::create_dir(skill_dir.join("examples")).expect("create examples dir");
    std::fs::create_dir(skill_dir.join("node_modules")).expect("create skipped dir");
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill").expect("write skill");
    std::fs::write(skill_dir.join("z.txt"), "z").expect("write root file");
    std::fs::write(skill_dir.join("examples").join("nested.md"), "nested").expect("write nested");
    std::fs::write(skill_dir.join("node_modules").join("package.json"), "{}")
        .expect("write skipped");

    let nodes = SkillService::build_file_tree_level_for_test(&skill_dir).expect("list level");
    let names: Vec<_> = nodes.iter().map(|node| node.name.as_str()).collect();

    assert_eq!(names, vec!["examples", "SKILL.md", "z.txt"]);
    let examples = nodes
        .iter()
        .find(|node| node.name == "examples")
        .expect("examples");
    assert!(examples.is_dir);
    assert!(examples.children.is_none());
    assert!(nodes
        .iter()
        .any(|node| node.name == "SKILL.md" && node.is_skill_md));
}

#[test]
fn test_scan_skill_root_for_test_scans_ssot_root_without_directory_guessing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let scan_root = dir.path().join("skills");
    let skill_dir = scan_root.join("exact-scan-ssot-test");
    std::fs::create_dir_all(&skill_dir).expect("create skill dir");
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: Exact SSOT\ndescription: Precise scan\n---\n\n# Body",
    )
    .expect("write skill");
    std::fs::write(skill_dir.join("notes.md"), "notes").expect("write notes");

    let entry =
        SkillService::scan_skill_root_for_test(&skill_dir, &scan_root, None).expect("scan root");

    assert_eq!(entry.id, "ssot:exact-scan-ssot-test");
    assert_eq!(entry.name, "exact-scan-ssot-test");
    assert_eq!(entry.yaml_name.as_deref(), Some("Exact SSOT"));
    assert_eq!(entry.description.as_deref(), Some("Precise scan"));
    assert_eq!(entry.directory, "exact-scan-ssot-test");
    assert_eq!(entry.origin, "ssot");
    assert_eq!(entry.home_path.as_deref(), skill_dir.to_str());
    assert_eq!(entry.home_agent, None);
    assert!(entry.content_hash.is_some());
}

#[test]
fn test_scan_skill_root_for_test_scans_agent_origin_without_ssot_fallback() {
    let dir = tempfile::tempdir().expect("tempdir");
    let scan_root = dir.path().join(".codex").join("skills");
    let skill_dir = scan_root.join("dupe-skill");
    std::fs::create_dir_all(&skill_dir).expect("create skill dir");
    std::fs::write(skill_dir.join("SKILL.md"), "# Agent skill").expect("write skill");

    let entry = SkillService::scan_skill_root_for_test(&skill_dir, &scan_root, Some("codex"))
        .expect("scan root");

    assert_eq!(entry.id, "agent:codex:dupe-skill");
    assert_eq!(entry.name, "dupe-skill");
    assert_eq!(entry.directory, "dupe-skill");
    assert_eq!(entry.origin, "agent");
    assert_eq!(entry.home_path.as_deref(), skill_dir.to_str());
    assert_eq!(entry.home_agent.as_deref(), Some("codex"));
    assert!(entry.apps.contains_key("codex"));
    assert!(entry.content_hash.is_some());
}
