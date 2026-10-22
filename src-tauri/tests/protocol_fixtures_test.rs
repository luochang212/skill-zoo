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
    // The populated baseline hash must parse and be usable for drift checks.
    assert_eq!(
        lock_entry.skill_folder_hash.as_deref(),
        Some("8293db63637957643abb559a59c1122ef387e21f61b60e8b0b3b2dfda73bae36")
    );
    assert!(lock_entry.content_baseline().is_some());
    // Unknown optional fields must survive parsing for read-modify-write
    // writers so future producers' data is not dropped.
    assert_eq!(
        lock.extra.get("futureTop").and_then(|v| v.as_str()),
        Some("keep-me")
    );
    assert_eq!(
        lock_entry
            .extra
            .get("futureOptional")
            .and_then(|v| v.as_str()),
        Some("keep-me")
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
fn test_desktop_migrates_legacy_metadata_fixture_keys() {
    let source = fixture_path("metadata-legacy-repo-keys.json");
    let original = fs::read_to_string(&source).expect("read metadata fixture");
    let input: serde_json::Value = serde_json::from_str(&original).expect("parse fixture");
    assert!(input["entries"]
        .as_object()
        .unwrap()
        .keys()
        .any(|key| key.starts_with("repo:")));
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("metadata.json");
    fs::copy(&source, &path).expect("copy metadata fixture");
    let store = skill_zoo_lib::persistence::metadata::MetadataStore::load_from(&path)
        .expect("load metadata fixture");

    // Legacy repo keys merge (OR) into canonical ssot keys.
    assert_eq!(store.get("ssot:demo").starred, true);
    assert_eq!(store.get("ssot:demo").is_mine, true);
    assert_eq!(store.get("ssot:category/nested").is_mine, true);
    assert_eq!(store.get("ssot:category/nested").starred, false);
    assert_eq!(store.get("ssot:kept").starred, true);
    assert_eq!(
        store
            .get("agent:codex:/Users/example/.codex/skills/local-skill")
            .is_mine,
        true
    );
    assert_eq!(store.get("external:demo-a1b2c3d4").is_mine, true);
    assert!(store.get("ssot:foo:bar").starred);
    assert!(store.get("ssot:foo:bar").is_mine);
    assert!(!store.entries.keys().any(|key| key.starts_with("repo:")));
    let persisted: skill_zoo_lib::persistence::metadata::MetadataStore =
        serde_json::from_str(&fs::read_to_string(&path).expect("read migrated metadata"))
            .expect("parse migrated metadata");
    assert_eq!(persisted.entries, store.entries);
    assert_eq!(
        fs::read_to_string(source).expect("reread fixture"),
        original
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
