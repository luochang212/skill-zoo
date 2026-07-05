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
    assert_eq!(lock_entry.commit_sha.as_deref(), Some("abc123"));

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
