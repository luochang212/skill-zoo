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

#[test]
fn desktop_verified_conflict_resolution_fixture_semantics() {
    use skill_zoo_lib::config;
    use skill_zoo_lib::services::lock::{
        content_tree_sha, BaselineConflictResolution, VerifiedAlignment,
    };
    let lock: SkillLock = read_fixture_json("lock-v3-legacy-conflicts.json");
    assert_eq!(lock.version, 3);

    // The fixture's real tree SHAs must match the content the test writes.
    let content_a = b"---\nname: verified-carrier\ndescription: fixture\n---\ncarrier content\n";
    let content_b = b"---\nname: verified-mirror\ndescription: fixture\n---\nmirror content\n";
    let tmp = tempfile::tempdir().unwrap();
    fs::write(tmp.path().join("SKILL.md"), content_a).unwrap();
    let sha_a = content_tree_sha(tmp.path()).unwrap();
    fs::write(tmp.path().join("SKILL.md"), content_b).unwrap();
    let sha_b = content_tree_sha(tmp.path()).unwrap();
    assert_eq!(
        sha_a,
        lock.skills["verified-carrier"]
            .skill_folder_hash
            .as_deref()
            .unwrap()
    );
    assert_eq!(
        sha_b,
        lock.skills["verified-mirror"]
            .commit_sha
            .as_deref()
            .unwrap()
    );

    let home = tempfile::tempdir().unwrap();
    config::with_test_home(home.path(), || {
        let skills_dir = config::get_agents_skills_dir();
        for (name, text) in [
            ("verified-carrier", &content_a[..]),
            ("verified-mirror", &content_b[..]),
            ("unverifiable-content", b"---\nname: x\n---\nunrelated\n"),
        ] {
            fs::create_dir_all(skills_dir.join(name)).unwrap();
            fs::write(skills_dir.join(name).join("SKILL.md"), text).unwrap();
        }
        lock.write().unwrap();
        let lock_path = config::get_agent_lock_file();

        // The resolution matrix over fixture shapes.
        let entry = |name: &str| lock.skills[name].clone();
        let dir = |name: &str| skills_dir.join(name);
        assert!(matches!(
            entry("verified-carrier").baseline_conflict_resolution(&dir("verified-carrier")),
            BaselineConflictResolution::Verified(_)
        ));
        assert!(matches!(
            entry("verified-mirror").baseline_conflict_resolution(&dir("verified-mirror")),
            BaselineConflictResolution::Verified(_)
        ));
        assert!(matches!(
            entry("unverifiable-content")
                .baseline_conflict_resolution(&dir("unverifiable-content")),
            BaselineConflictResolution::Unverifiable
        ));
        assert!(matches!(
            entry("missing-directory").baseline_conflict_resolution(&dir("missing-directory")),
            BaselineConflictResolution::Unverifiable
        ));

        // Applying the verified alignments rewrites exactly the two carrier
        // fields and preserves everything else, including undeclared fields.
        let alignments: Vec<VerifiedAlignment> = ["verified-carrier", "verified-mirror"]
            .iter()
            .map(|name| {
                let conflicted = entry(name);
                let (carrier, mirror) = conflicted
                    .baseline_conflict()
                    .expect("conflicted fixture entry");
                VerifiedAlignment {
                    lock_key: name.to_string(),
                    carrier: carrier.to_string(),
                    mirror: mirror.to_string(),
                    verified: match conflicted.baseline_conflict_resolution(&dir(name)) {
                        BaselineConflictResolution::Verified(sha) => sha,
                        _ => unreachable!(),
                    },
                }
            })
            .collect();
        let applied = SkillLock::apply_verified_alignments(&alignments).unwrap();
        assert_eq!(applied.len(), 2);

        let after: SkillLock = serde_json::from_slice(&fs::read(&lock_path).unwrap()).unwrap();
        for name in ["verified-carrier", "verified-mirror"] {
            let e = &after.skills[name];
            assert_eq!(e.skill_folder_hash, e.commit_sha, "{name} aligned");
            assert_eq!(
                e.extra.get("externalNote"),
                Some(&serde_json::json!({ "keep": true })),
                "{name} undeclared fields preserved"
            );
            assert_eq!(e.installed_at.as_deref(), Some("2025-01-01T00:00:00Z"));
        }
        // Unresolvable entries keep their carriers and their conflict.
        for name in ["unverifiable-content", "missing-directory"] {
            let e = &after.skills[name];
            assert!(e.baseline_conflict().is_some(), "{name} still conflicted");
        }
        // Top-level shape unchanged; version intact.
        assert_eq!(after.version, 3);
    });
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

#[test]
fn desktop_provenance_fixture_refusal_preserves_physical_files_and_lock() {
    use skill_zoo_lib::services::skill_provenance::{
        ensure_update_allowed, inspect_gh_tracking, Provenance,
    };
    let home = tempfile::tempdir().unwrap();
    skill_zoo_lib::config::with_test_home(home.path(), || {
        let target = home.path().join(".agents/skills/demo");
        fs::create_dir_all(&target).unwrap();
        let original = fs::read(fixture_path("gh-injected.md")).unwrap();
        fs::write(target.join("SKILL.md"), &original).unwrap();
        let lock_path = home.path().join(".agents/.skill-lock.json");
        fs::copy(fixture_path("lock-v3-full.json"), &lock_path).unwrap();
        let before = fs::read(&lock_path).unwrap();
        assert_eq!(
            ensure_update_allowed(&target).unwrap_err().code,
            "ghProvenanceProtected"
        );
        assert_eq!(fs::read(target.join("SKILL.md")).unwrap(), original);
        assert_eq!(fs::read(lock_path).unwrap(), before);
        let cases: serde_json::Value = read_fixture_json("gh-update-guard-cases.json");
        for case in cases.as_array().unwrap() {
            let state = match inspect_gh_tracking(case["text"].as_str().unwrap()) {
                Provenance::Absent => "Absent",
                Provenance::Tracking => "Tracking",
                Provenance::Unreadable(_) => "Unreadable",
            };
            assert_eq!(
                state,
                case["expected"].as_str().unwrap(),
                "{}",
                case["name"]
            );
        }
    });
}

#[test]
fn real_installation_layouts_share_scan_and_resolution_semantics() {
    use skill_zoo_lib::{
        config,
        services::{
            lock::{resolve_installation_lock, LockResolution},
            skill::SkillService,
        },
    };
    let cases: serde_json::Value = read_fixture_json("lock-resolution-layouts.json");
    for case in cases.as_array().unwrap() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let mut paths = Vec::new();
            let mut imports = ExternalImports::default();
            for d in case["directories"].as_array().unwrap() {
                let origin = d["origin"].as_str().unwrap();
                let root = match origin {
                    "ssot" => config::get_agents_skills_dir(),
                    "agent" => config::get_agent_skills_dir("codex").unwrap(),
                    _ => tmp.path().join("external"),
                };
                let home = root.join(d["directory"].as_str().unwrap());
                fs::create_dir_all(&home).unwrap();
                fs::write(home.join("SKILL.md"), d["text"].as_str().unwrap()).unwrap();
                if origin == "external" {
                    imports.imports.insert(
                        "external:demo".into(),
                        skill_zoo_lib::persistence::ExternalImportEntry {
                            id: "external:demo".into(),
                            directory: "demo".into(),
                            source_path: home.to_string_lossy().into(),
                            imported_at: 1,
                            updated_at: 1,
                        },
                    );
                }
                paths.push((home, root, origin.to_string()));
            }
            imports.save().unwrap();
            if let Some(links) = case["links"].as_array() {
                for link in links {
                    let root = config::get_agent_skills_dir("codex").unwrap();
                    fs::create_dir_all(&root).unwrap();
                    SkillService::create_link_to_target_for_test(
                        &paths[link["target"].as_u64().unwrap() as usize].0,
                        &root.join(link["directory"].as_str().unwrap()),
                    )
                    .unwrap();
                }
            }
            let lock: SkillLock = serde_json::from_value(case["lock"].clone()).unwrap();
            lock.write().unwrap();
            let lock_path = config::get_agent_lock_file();
            let before = fs::read(&lock_path).unwrap();
            let inventory = SkillService::collect_installations().unwrap();
            let full_scan = SkillService::scan_filesystem_for_test().unwrap();
            for (index, (home, root, origin)) in paths.iter().enumerate() {
                let result = if let Some(target) = inventory
                    .iter()
                    .find(|i| i.home_path == home.canonicalize().unwrap())
                {
                    resolve_installation_lock(target, &inventory, &lock)
                } else {
                    LockResolution::Missing {
                        reason: "outsideLockScope",
                    }
                };
                let actual = match &result {
                    LockResolution::Resolved { lock_key, .. } => format!("Resolved:{lock_key}"),
                    LockResolution::Missing { .. } => "Missing".into(),
                    LockResolution::Ambiguous { reason, .. } => format!("Ambiguous:{reason}"),
                };
                assert_eq!(
                    actual,
                    case["expected"][index].as_str().unwrap(),
                    "{}",
                    case["name"]
                );
                if origin != "external" {
                    let scanned = SkillService::scan_skill_root(
                        home,
                        root,
                        (origin == "agent").then_some("codex"),
                    )
                    .unwrap();
                    assert_eq!(scanned.directory, case["directories"][index]["directory"]);
                    assert_eq!(
                        scanned.repo_owner.is_some(),
                        matches!(result, LockResolution::Resolved { .. }),
                        "{}",
                        case["name"]
                    );
                    if origin == "ssot" {
                        assert_eq!(
                            SkillService::scan_single_skill(&scanned.directory)
                                .unwrap()
                                .repo_owner,
                            scanned.repo_owner
                        );
                    }
                    let batch = SkillService::scan_skill_roots_batch(&[(
                        home.clone(),
                        root.clone(),
                        (origin == "agent").then(|| "codex".into()),
                    )])
                    .unwrap();
                    assert_eq!(batch[0].repo_owner, scanned.repo_owner);
                    let full = full_scan
                        .iter()
                        .find(|i| i.directory == scanned.directory && i.origin == scanned.origin)
                        .unwrap();
                    assert_eq!(full.repo_owner, scanned.repo_owner);
                }
            }
            assert_eq!(before, fs::read(lock_path).unwrap());
        });
    }
}
