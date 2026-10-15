use skill_zoo_lib::persistence::{ArchiveManifest, ExternalImports};
use skill_zoo_lib::services::lock::SkillLock;
use std::fs;
use std::path::PathBuf;

#[test]
fn test_desktop_reads_current_protocol_fixtures() {
    let lock: SkillLock = read_fixture_json("lock-v3-full.json");
    let manifest: ArchiveManifest = read_fixture_json("archive-v1-full.json");
    let imports: ExternalImports = read_fixture_json("imports-v1-full.json");

    assert_eq!(lock.version, 3);
    let lock_entry = lock.skills.get("demo").expect("lock entry");
    assert_eq!(lock_entry.source.as_deref(), Some("owner/repo"));
    assert_eq!(lock_entry.source_type.as_deref(), Some("github"));
    assert_eq!(
        lock_entry.source_url.as_deref(),
        Some("https://github.com/owner/repo")
    );
    assert_eq!(lock_entry.branch.as_deref(), Some("main"));
    assert_eq!(lock_entry.skill_path.as_deref(), Some("skills/demo"));
    assert_eq!(
        lock_entry.commit_sha.as_deref(),
        Some("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0")
    );
    assert_eq!(
        lock_entry.skill_folder_hash.as_deref(),
        Some("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0")
    );

    assert_eq!(manifest.version, 1);
    let archived = manifest.skills.get("demo-abc123").expect("archive entry");
    assert_eq!(archived.archive_id, "demo-abc123");
    assert_eq!(archived.original_skill_id, "repo:owner/repo:demo");
    assert_eq!(archived.name, "demo");
    assert_eq!(archived.lock_key.as_deref(), Some("demo"));
    assert_eq!(archived.archived_by_version.as_deref(), Some("0.2.9"));
    assert_eq!(archived.apps.get("codex"), Some(&true));
    assert_eq!(
        archived
            .lock_entry
            .as_ref()
            .and_then(|entry| entry.source.as_deref()),
        Some("owner/repo")
    );

    assert_eq!(imports.version, 1);
    let import = imports
        .imports
        .get("external:demo-a1b2c3d4")
        .expect("external import");
    assert_eq!(import.directory, "skills/demo");
    assert_eq!(
        import.source_path,
        "/Users/example/private-skills/skills/demo"
    );
}

#[test]
fn test_desktop_applies_defaults_for_minimal_protocol_fixtures() {
    let lock: SkillLock = read_fixture_json("lock-v3-minimal.json");
    let manifest: ArchiveManifest = read_fixture_json("archive-v1-minimal.json");
    let imports: ExternalImports = read_fixture_json("imports-v1-minimal.json");

    assert_eq!(lock.version, 3);
    assert!(lock.skills.is_empty());
    assert_eq!(manifest.version, 1);
    assert!(manifest.skills.is_empty());
    assert_eq!(imports.version, 1);
    assert!(imports.imports.is_empty());
}

#[test]
fn test_desktop_classifies_gh_shaped_lock_entries() {
    let lock: SkillLock = read_fixture_json("lock-v3-external-writers.json");

    // Mirror stripped by an external writer: the surviving carrier still
    // provides a baseline, so the entry compares normally.
    let demo = lock.skills.get("demo").expect("demo entry");
    assert!(!demo.is_externally_pinned());
    assert_eq!(
        demo.recorded_baseline(),
        Some("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0")
    );
    assert!(demo.baseline_conflict().is_none());

    // Disagreeing carriers are an explicit conflict, never reconciled.
    let conflicted = lock.skills.get("conflicted").expect("conflicted entry");
    assert_eq!(
        conflicted.baseline_conflict(),
        Some((
            "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
            "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0a1"
        ))
    );

    // No carrier recorded: needs re-confirmation, not "up to date".
    let unrecorded = lock.skills.get("unrecorded").expect("unrecorded entry");
    assert!(!unrecorded.is_externally_pinned());
    assert_eq!(unrecorded.recorded_baseline(), None);
    assert!(unrecorded.baseline_conflict().is_none());

    // Externally pinned entry with full carriers: skipped, fields untouched.
    let foreign_pinned = lock.skills.get("foreign-pinned").expect("pinned entry");
    assert!(foreign_pinned.is_externally_pinned());
    assert_eq!(
        foreign_pinned.recorded_baseline(),
        foreign_pinned.commit_sha.as_deref()
    );

    // Undeclared fields survive a desktop read-modify-write of this fixture.
    let rewritten = serde_json::to_string_pretty(&lock).expect("serialize");
    let reread: SkillLock = serde_json::from_str(&rewritten).expect("deserialize");
    assert_eq!(
        reread.skills["foreign-pinned"].pinned_ref.as_deref(),
        Some("abc1234")
    );
    assert_eq!(
        reread.skills["demo"].extra.get("externalNote"),
        Some(&serde_json::json!({ "kept": true }))
    );
    assert_eq!(
        reread.extra.get("futureTopLevel"),
        Some(&serde_json::json!({ "note": "preserve me" }))
    );
}

fn read_fixture_json<T: serde::de::DeserializeOwned>(name: &str) -> T {
    let content = fs::read_to_string(fixture_path(name)).expect("read fixture");
    serde_json::from_str(&content).expect("parse fixture")
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo root")
        .join("fixtures")
        .join("local-protocol")
        .join(name)
}
