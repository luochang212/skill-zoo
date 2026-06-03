mod common;

use common::make_lock_entry;
use skill_zoo_lib::persistence::{ArchiveManifest, ArchivedSkill};
use std::collections::{BTreeMap, HashMap};

#[test]
fn test_archive_id_is_stable_and_path_safe() {
    let first =
        ArchiveManifest::make_archive_id("repo:owner/repo:nested/my skill", "nested/my skill");
    let second =
        ArchiveManifest::make_archive_id("repo:owner/repo:nested/my skill", "nested/my skill");

    assert_eq!(first, second);
    assert!(first.starts_with("my-skill-"));
    assert!(first
        .chars()
        .all(|c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'));
}

#[test]
fn test_archive_manifest_round_trips_skill_metadata() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let manifest_path = tmp.path().join("manifest.json");
    let mut apps = HashMap::new();
    apps.insert("codex".to_string(), true);
    apps.insert("gemini".to_string(), false);

    let skill = ArchivedSkill {
        id: "my-skill-abc123".to_string(),
        archive_id: "my-skill-abc123".to_string(),
        original_skill_id: "repo:owner/repo:my-skill".to_string(),
        name: "my-skill".to_string(),
        yaml_name: Some("My Skill".to_string()),
        description: Some("Archived test skill".to_string()),
        directory: "my-skill".to_string(),
        repo_owner: Some("owner".to_string()),
        repo_name: Some("repo".to_string()),
        source_url: Some("https://github.com/owner/repo".to_string()),
        apps,
        origin: "ssot".to_string(),
        home_path: Some("/tmp/.agents/skills/my-skill".to_string()),
        content_hash: Some("hash".to_string()),
        home_agent: None,
        starred: true,
        is_mine: true,
        installed_at: 100,
        updated_at: 200,
        archived_at: 300,
        lock_key: Some("my-skill".to_string()),
        lock_entry: Some(make_lock_entry("owner/repo")),
        archived_by_version: Some("test".to_string()),
        reason: None,
    };

    let manifest = ArchiveManifest {
        version: 1,
        skills: BTreeMap::from([(skill.archive_id.clone(), skill.clone())]),
    };

    manifest.save_to(&manifest_path).expect("save manifest");
    let loaded = ArchiveManifest::load_from(&manifest_path).expect("load manifest");
    let loaded_skill = loaded.skills.get("my-skill-abc123").expect("skill entry");

    assert_eq!(loaded_skill.original_skill_id, skill.original_skill_id);
    assert_eq!(loaded_skill.lock_key.as_deref(), Some("my-skill"));
    assert_eq!(
        loaded_skill
            .lock_entry
            .as_ref()
            .and_then(|e| e.source.as_deref()),
        Some("owner/repo")
    );
    assert!(loaded_skill.starred);
    assert!(loaded_skill.is_mine);
    assert_eq!(loaded_skill.apps.get("codex"), Some(&true));
}
