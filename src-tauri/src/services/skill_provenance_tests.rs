use super::*;
use crate::commands::{
    settings::check_skill_updates,
    skill::{update_all_skills_inner, update_skill_inner, CheckedSkillUpdate},
};
use crate::persistence::{MetadataStore, Settings, SkillCache};
use crate::services::skill_provenance::{inspect_gh_tracking, read_gh_tracking, Provenance};
use crate::store::AppState;
use std::{collections::BTreeMap, fs, io::Write};

fn network(base: &str) -> impl Drop {
    struct Scope(Option<String>);
    impl Drop for Scope {
        fn drop(&mut self) {
            TEST_UPDATE_SERVER.with(|v| *v.borrow_mut() = self.0.take());
        }
    }
    Scope(TEST_UPDATE_SERVER.with(|v| v.replace(Some(base.into()))))
}
fn gh_list() -> Option<serde_json::Value> {
    let binary = std::env::var_os("SKILL_ZOO_TEST_GH")?;
    let result = std::process::Command::new(binary)
        .args(["skill", "list", "--dir"])
        .arg(config::get_agents_skills_dir())
        .args(["--json", "skillName,sourceURL,version"])
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    Some(serde_json::from_slice(&result.stdout).unwrap())
}
fn isolated(run: impl FnOnce()) {
    let home = tempfile::tempdir().unwrap();
    config::with_test_home(home.path(), run);
}
fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}
fn fixture(name: &str) -> Vec<u8> {
    fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../fixtures/local-protocol")
            .join(name),
    )
    .unwrap()
}
fn entry() -> SkillLockEntry {
    serde_json::from_value(serde_json::json!({
        "source":"owner/repo", "sourceType":"github", "ref":"main", "skillPath":"skills/demo",
        "commitSha":"old", "skillFolderHash":"old", "installedAt":"2025-01-01T00:00:00Z",
        "updatedAt":"2025-01-02T00:00:00Z", "externalNote":{"keep":true}
    }))
    .unwrap()
}
/// An entry whose dual baseline carriers were lost, e.g. written by an
/// older tool or stripped by an external rewrite of the lock file.
fn unbaselined_entry() -> SkillLockEntry {
    serde_json::from_value(serde_json::json!({
        "source":"owner/repo", "sourceType":"github", "ref":"main", "skillPath":"skills/demo",
        "installedAt":"2025-01-01T00:00:00Z",
        "updatedAt":"2025-01-02T00:00:00Z", "externalNote":{"keep":true}
    }))
    .unwrap()
}
fn install(name: &str, text: &[u8]) {
    let dir = config::get_agents_skills_dir().join(name);
    fs::create_dir_all(dir.join("nested")).unwrap();
    fs::write(dir.join("SKILL.md"), text).unwrap();
    fs::write(dir.join("nested/keep.bin"), [0, 255, 42]).unwrap();
    SkillLock::update(|lock| {
        lock.skills.insert(name.into(), entry());
        Ok(())
    })
    .unwrap();
}
fn state(names: &[&str]) -> AppState {
    let entries = names
        .iter()
        .map(|name| SkillService::scan_single_skill(name).unwrap())
        .collect();
    AppState::new(
        SkillCache::from_entries(entries),
        MetadataStore::empty(),
        Settings {
            values: Default::default(),
        },
    )
}
fn lock_path() -> PathBuf {
    config::get_agents_skills_dir()
        .parent()
        .unwrap()
        .join(".skill-lock.json")
}
fn directory_bytes(dir: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, output: &mut BTreeMap<PathBuf, Vec<u8>>) {
        for item in fs::read_dir(dir).unwrap() {
            let path = item.unwrap().path();
            if path.is_symlink() {
                output.insert(
                    path.strip_prefix(root).unwrap().to_owned(),
                    fs::read_link(&path)
                        .unwrap()
                        .to_string_lossy()
                        .as_bytes()
                        .to_vec(),
                );
            } else if path.is_dir() {
                walk(root, &path, output);
            } else {
                output.insert(
                    path.strip_prefix(root).unwrap().to_owned(),
                    fs::read(&path).unwrap(),
                );
            }
        }
    }
    let mut result = BTreeMap::new();
    walk(dir, dir, &mut result);
    result
}
fn zip() -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    writer
        .start_file(
            "repo-main/skills/demo/SKILL.md",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
    writer
        .write_all(b"---\nname: demo\ndescription: new\n---\nnew body")
        .unwrap();
    writer.finish().unwrap().into_inner()
}
async fn tree(server: &mut mockito::ServerGuard, count: usize) -> mockito::Mock {
    server
        .mock("GET", "/repos/owner/repo/git/trees/main?recursive=1")
        .expect(count)
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"sha":"root","tree":[{"type":"tree","path":"skills/demo","sha":"new"}]}"#)
        .create_async()
        .await
}
async fn archive(server: &mut mockito::ServerGuard, count: usize) -> mockito::Mock {
    server
        .mock("GET", "/owner/repo/archive/refs/heads/main.zip")
        .expect(count)
        .with_status(200)
        .with_body(zip())
        .create_async()
        .await
}

#[test]
fn shared_yaml_guard_contract() {
    let cases: serde_json::Value =
        serde_json::from_slice(&fixture("gh-update-guard-cases.json")).unwrap();
    for case in cases.as_array().unwrap() {
        let result = inspect_gh_tracking(case["text"].as_str().unwrap());
        let actual = match result {
            Provenance::Absent => "Absent",
            Provenance::Tracking => "Tracking",
            Provenance::Unreadable(_) => "Unreadable",
        };
        assert_eq!(
            actual,
            case["expected"].as_str().unwrap(),
            "{}",
            case["name"]
        );
    }
    isolated(|| {
        let dir = config::get_agents_skills_dir().join("demo");
        fs::create_dir_all(&dir).unwrap();
        assert!(matches!(read_gh_tracking(&dir), Provenance::Unreadable(_)));
        fs::create_dir(dir.join("SKILL.md")).unwrap();
        assert!(matches!(read_gh_tracking(&dir), Provenance::Unreadable(_)));
        fs::remove_dir(dir.join("SKILL.md")).unwrap();
        fs::write(dir.join("SKILL.md"), [255]).unwrap();
        assert!(matches!(read_gh_tracking(&dir), Provenance::Unreadable(_)));
        fs::write(dir.join("SKILL.md"), "ordinary").unwrap();
        assert_eq!(read_gh_tracking(&dir), Provenance::Absent);
    });
}

#[test]
fn protected_commands_and_direct_service_never_fetch_or_write() {
    isolated(|| {
        runtime().block_on(async {
            install("demo", &fixture("gh-injected.md"));
            #[cfg(unix)]
            std::os::unix::fs::symlink(
                "keep.bin",
                config::get_agents_skills_dir().join("demo/nested/keep-link"),
            )
            .unwrap();
            let state = state(&["demo"]);
            let id = state
                .skill_cache
                .read()
                .unwrap()
                .iter()
                .next()
                .unwrap()
                .id
                .clone();
            let before = directory_bytes(&config::get_agents_skills_dir());
            let lock_before = fs::read(lock_path()).unwrap();
            let mut server = mockito::Server::new_async().await;
            let tree = tree(&mut server, 0).await;
            let archive = archive(&mut server, 0).await;
            // Run futures on the current thread so scoped HOME and network overrides survive awaits.
            let _network = network(&server.url());
            let gh_before = gh_list();
            let single = update_skill_inner(&state, id).await.unwrap_err();
            assert_eq!(single.code, "ghProvenanceProtected");
            let all = update_all_skills_inner(&state, None).await.unwrap();
            assert_eq!(all.fail_count, 1);
            assert!(all.errors[0].contains("[ghProvenanceProtected]"));
            let checked = update_all_skills_inner(
                &state,
                Some(vec![CheckedSkillUpdate {
                    skill_name: "demo".into(),
                    current_sha: "old".into(),
                    latest_sha: "new".into(),
                }]),
            )
            .await
            .unwrap();
            assert_eq!(checked.fail_count, 1);
            assert!(checked.errors[0].contains("[ghProvenanceProtected]"));
            let direct = CliService::update_known_skill_entries(vec![KnownSkillUpdate {
                install_directory: "demo".into(),
                lock_key: "demo".into(),
                entry: entry(),
                latest_sha: "new".into(),
            }])
            .await
            .unwrap();
            assert_eq!(direct.fail_count, 1);
            assert!(direct.errors[0].contains("[ghProvenanceProtected]"));
            let check = check_skill_updates().await.unwrap();
            assert_eq!(
                check.skills[0].check_error_code.as_deref(),
                Some("ghProvenanceProtected")
            );
            assert!(!check.skills[0].has_update);
            assert_eq!(before, directory_bytes(&config::get_agents_skills_dir()));
            assert_eq!(lock_before, fs::read(lock_path()).unwrap());
            if let Some(before) = gh_before {
                let after = gh_list().unwrap();
                assert_eq!(before, after);
                assert_eq!(
                    after[0]["sourceURL"],
                    "https://github.com/vercel-labs/skills"
                );
                assert_eq!(after[0]["version"], "main");
            }
            tree.assert_async().await;
            archive.assert_async().await;
        })
    });
}

#[test]
fn ordinary_yaml_variants_really_update_and_mixed_batch_preserves_protected_entry() {
    isolated(|| {
        runtime().block_on(async {
            let cases: serde_json::Value =
                serde_json::from_slice(&fixture("gh-update-guard-cases.json")).unwrap();
            install("protected", &fixture("gh-injected.md"));
            let protected_before =
                directory_bytes(&config::get_agents_skills_dir().join("protected"));
            let entry_before =
                serde_json::to_value(&SkillLock::read().unwrap().skills["protected"]).unwrap();
            let mut names = vec!["protected".to_owned()];
            for (index, case) in cases
                .as_array()
                .unwrap()
                .iter()
                .filter(|c| c["expected"] == "Absent")
                .enumerate()
            {
                let name = format!("ordinary-{index}");
                install(&name, case["text"].as_str().unwrap().as_bytes());
                names.push(name);
            }
            let refs: Vec<_> = names.iter().map(String::as_str).collect();
            let state = state(&refs);
            let mut server = mockito::Server::new_async().await;
            let tree = tree(&mut server, 1).await;
            let archive = archive(&mut server, 1).await;
            let _network = network(&server.url());
            let result = update_all_skills_inner(&state, None).await.unwrap();
            assert_eq!(result.fail_count, 1);
            assert_eq!(result.success_count, names.len() - 1);
            let lock = SkillLock::read().unwrap();
            assert_eq!(
                serde_json::to_value(&lock.skills["protected"]).unwrap(),
                entry_before
            );
            assert_eq!(
                directory_bytes(&config::get_agents_skills_dir().join("protected")),
                protected_before
            );
            for name in &names[1..] {
                assert!(fs::read_to_string(
                    config::get_agents_skills_dir().join(name).join("SKILL.md")
                )
                .unwrap()
                .ends_with("new body"));
                assert_eq!(lock.skills[name].commit_sha.as_deref(), Some("new"));
                assert_eq!(lock.skills[name].skill_folder_hash.as_deref(), Some("new"));
            }
            let history = crate::persistence::update_history::SkillUpdateHistory::load().unwrap();
            let record = history.records.values().next().unwrap();
            assert_eq!(record.status, "partial");
            assert_eq!(record.failed_skills, ["protected"]);
            assert_eq!(record.updated_skills.len(), names.len() - 1);
            tree.assert_async().await;
            archive.assert_async().await;
        })
    });
}

#[test]
fn single_update_refuses_entry_without_recorded_baseline() {
    isolated(|| {
        runtime().block_on(async {
            install("demo", b"---\nname: demo\n---\nold body");
            SkillLock::update(|lock| {
                lock.skills.insert("demo".into(), unbaselined_entry());
                Ok(())
            })
            .unwrap();
            let state = state(&["demo"]);
            let lock_before = fs::read(lock_path()).unwrap();
            let dir_before = directory_bytes(&config::get_agents_skills_dir().join("demo"));
            let mut server = mockito::Server::new_async().await;
            let tree_mock = tree(&mut server, 0).await;
            let archive_mock = archive(&mut server, 0).await;
            let _network = network(&server.url());
            let error = update_skill_inner(&state, "repo:owner/repo:demo".to_string())
                .await
                .err()
                .expect("single update must refuse an entry without a recorded baseline");
            assert_eq!(error.code, "baselineMissing");
            assert!(error.message.contains("Missing update baseline"));
            // A refusal must not touch the lock file or the installation.
            assert_eq!(fs::read(lock_path()).unwrap(), lock_before);
            assert_eq!(
                directory_bytes(&config::get_agents_skills_dir().join("demo")),
                dir_before
            );
            // The refusal fires before any network work.
            tree_mock.assert_async().await;
            archive_mock.assert_async().await;
        })
    });
}

/// A conflicted legacy entry: `skillFolderHash` recorded by the external
/// installer, `commitSha` rewritten by a pre-dual-baseline app update.
fn conflicted_entry(carrier: &str, mirror: &str) -> SkillLockEntry {
    serde_json::from_value(serde_json::json!({
        "source":"owner/repo", "sourceType":"github", "ref":"main", "skillPath":"skills/demo",
        "skillFolderHash": carrier, "commitSha": mirror,
        "installedAt":"2025-01-01T00:00:00Z",
        "updatedAt":"2025-01-02T00:00:00Z", "externalNote":{"keep":true}
    }))
    .unwrap()
}

/// Writes a conflicted legacy entry whose carrier matches the installed
/// content (field shape: the external installer recorded the true tree, a
/// pre-dual-baseline app update later rewrote only the mirror). Returns the
/// verified local tree SHA.
fn write_conflicted_entry_matching_carrier(name: &str, mirror: &str) -> String {
    let sha = crate::services::lock::content_tree_sha(&config::get_agents_skills_dir().join(name))
        .unwrap();
    SkillLock::update(|lock| {
        lock.skills
            .insert(name.to_string(), conflicted_entry(&sha, mirror));
        Ok(())
    })
    .unwrap();
    sha
}

/// Writes a conflicted legacy entry whose mirror matches the installed
/// content (field shape: the app update rewrote the mirror, the carrier is
/// the stale installer tree). Returns the verified local tree SHA.
fn write_conflicted_entry_matching_mirror(name: &str, carrier: &str) -> String {
    let sha = crate::services::lock::content_tree_sha(&config::get_agents_skills_dir().join(name))
        .unwrap();
    SkillLock::update(|lock| {
        lock.skills
            .insert(name.to_string(), conflicted_entry(carrier, &sha));
        Ok(())
    })
    .unwrap();
    sha
}

/// Writes a conflicted legacy entry matching neither carrier.
fn write_unverifiable_conflicted_entry(name: &str) {
    SkillLock::update(|lock| {
        lock.skills.insert(
            name.to_string(),
            conflicted_entry(LEGACY_CARRIER, LEGACY_MIRROR),
        );
        Ok(())
    })
    .unwrap();
}

const LEGACY_CARRIER: &str = "1111111111111111111111111111111111111111";
const LEGACY_MIRROR: &str = "2222222222222222222222222222222222222222";

#[test]
fn check_resolves_legacy_conflicts_with_verified_local_content() {
    isolated(|| {
        runtime().block_on(async {
            install("demo", b"---\nname: demo\n---\nold body");
            // Field-evidenced shape: the mirror was rewritten by the app and
            // the local content matches it; the carrier is stale.
            let local_sha = write_conflicted_entry_matching_mirror("demo", LEGACY_CARRIER);
            // A directory-less conflicted entry must stay explicit.
            SkillLock::update(|lock| {
                lock.skills.insert(
                    "gone".into(),
                    conflicted_entry("3333333333333333333333333333333333333333", LEGACY_MIRROR),
                );
                Ok(())
            })
            .unwrap();
            let gone_before = SkillLock::read().unwrap().skills["gone"].clone();
            let mut server = mockito::Server::new_async().await;
            let tree_mock = tree(&mut server, 1).await;
            let _network = network(&server.url());

            let check = check_skill_updates().await.unwrap();
            let status = check
                .skills
                .iter()
                .find(|s| s.skill_name == "demo")
                .unwrap();
            // Aligned: compared against the verified baseline like any skill,
            // and the remote differs so the pending update stays visible.
            assert_eq!(status.baseline_state, "ok");
            assert!(status.has_update);
            assert_eq!(status.current_sha.as_deref(), Some(local_sha.as_str()));
            assert!(!check.skills.iter().any(|s| s.skill_name == "gone"));

            let lock = SkillLock::read().unwrap();
            assert_eq!(
                lock.skills["demo"].skill_folder_hash.as_deref(),
                Some(local_sha.as_str())
            );
            assert_eq!(
                lock.skills["demo"].commit_sha.as_deref(),
                Some(local_sha.as_str())
            );
            // Only the two carrier fields were rewritten; everything else,
            // including undeclared fields, survived.
            assert_eq!(
                lock.skills["demo"].extra.get("externalNote"),
                Some(&serde_json::json!({"keep": true}))
            );
            assert_eq!(
                lock.skills["demo"].installed_at.as_deref(),
                Some("2025-01-01T00:00:00Z")
            );
            // No other entry was written, including the unverifiable one.
            assert_eq!(lock.skills["gone"], gone_before);
            tree_mock.assert_async().await;
        })
    });
}

#[test]
fn check_keeps_conflict_when_alignment_cannot_be_persisted() {
    isolated(|| {
        runtime().block_on(async {
            install("demo", b"---\nname: demo\n---\nold body");
            write_conflicted_entry_matching_mirror("demo", LEGACY_CARRIER);
            let lock_before = fs::read(lock_path()).unwrap();
            let mut server = mockito::Server::new_async().await;
            let tree_mock = tree(&mut server, 0).await;
            let _network = network(&server.url());
            // Another writer holds the lease, so the check cannot persist the
            // alignment. It must not report the entry as unconflicted while
            // the lock still disagrees.
            let _lease = crate::persistence::agent_transaction::AgentLease::acquire(
                &config::get_app_config_dir(),
            )
            .unwrap();

            let check = check_skill_updates().await.unwrap();
            assert_eq!(check.skills[0].baseline_state, "conflict");
            assert_eq!(
                check.skills[0].check_error_code.as_deref(),
                Some("baselineConflict")
            );
            assert_eq!(fs::read(lock_path()).unwrap(), lock_before);
            tree_mock.assert_async().await;
        })
    });
}

#[test]
fn update_paths_resolve_verified_conflicts_and_keep_unverifiable_ones() {
    isolated(|| {
        runtime().block_on(async {
            install("demo", b"---\nname: demo\n---\nold body");
            install("stuck", b"---\nname: stuck\n---\nold body");
            write_conflicted_entry_matching_mirror("demo", LEGACY_CARRIER);
            write_unverifiable_conflicted_entry("stuck");
            let state = state(&["demo", "stuck"]);
            let stuck_entry_before = SkillLock::read().unwrap().skills["stuck"].clone();
            let stuck_before = directory_bytes(&config::get_agents_skills_dir().join("stuck"));
            let mut server = mockito::Server::new_async().await;
            let tree_mock = tree(&mut server, 1).await;
            let archive_mock = archive(&mut server, 1).await;
            let _network = network(&server.url());

            let result = update_all_skills_inner(&state, None).await.unwrap();
            // The verified conflict updated like any skill…
            assert_eq!(result.success_count, 1);
            assert_eq!(result.updated, vec!["demo".to_string()]);
            let lock = SkillLock::read().unwrap();
            assert_eq!(
                lock.skills["demo"].skill_folder_hash.as_deref(),
                Some("new")
            );
            assert_eq!(lock.skills["demo"].commit_sha.as_deref(), Some("new"));
            // …while the unverifiable conflict refused with its state intact.
            assert!(result.errors[0].contains("stuck: [baselineConflict]"));
            assert_eq!(lock.skills["stuck"], stuck_entry_before);
            assert_eq!(
                directory_bytes(&config::get_agents_skills_dir().join("stuck")),
                stuck_before
            );
            tree_mock.assert_async().await;
            archive_mock.assert_async().await;
        })
    });
}

#[test]
fn checked_request_with_stale_baseline_still_updates_verified_conflict() {
    isolated(|| {
        runtime().block_on(async {
            install("demo", b"---\nname: demo\n---\nold body");
            // Field-evidenced opposite direction: the carrier matches the
            // local content and the mirror is the pre-dual-baseline value.
            let local_sha = write_conflicted_entry_matching_carrier("demo", LEGACY_MIRROR);
            let state = state(&["demo"]);
            let mut server = mockito::Server::new_async().await;
            // The checked path trusts the check-time latest_sha and downloads
            // the archive directly — no tree fetch.
            let archive_mock = archive(&mut server, 1).await;
            let _network = network(&server.url());

            // A checked request captured before the alignment (current_sha is
            // the carrier) must still proceed: alignment rewrites the mirror,
            // the baseline comparison sees the same verified value.
            let result = update_all_skills_inner(
                &state,
                Some(vec![CheckedSkillUpdate {
                    skill_name: "demo".into(),
                    current_sha: local_sha.clone(),
                    latest_sha: "new".into(),
                }]),
            )
            .await
            .unwrap();
            assert_eq!(result.success_count, 1);
            let lock = SkillLock::read().unwrap();
            assert_eq!(
                lock.skills["demo"].skill_folder_hash.as_deref(),
                Some("new")
            );
            assert_eq!(lock.skills["demo"].commit_sha.as_deref(), Some("new"));
            archive_mock.assert_async().await;
        })
    });
}

#[test]
fn checked_request_for_unverifiable_conflict_refuses_without_touching_state() {
    isolated(|| {
        runtime().block_on(async {
            install("demo", b"---\nname: demo\n---\nold body");
            write_unverifiable_conflicted_entry("demo");
            let state = state(&["demo"]);
            let lock_before = fs::read(lock_path()).unwrap();
            let dir_before = directory_bytes(&config::get_agents_skills_dir().join("demo"));
            let mut server = mockito::Server::new_async().await;
            let tree_mock = tree(&mut server, 0).await;
            let archive_mock = archive(&mut server, 0).await;
            let _network = network(&server.url());

            let result = update_all_skills_inner(
                &state,
                Some(vec![CheckedSkillUpdate {
                    skill_name: "demo".into(),
                    current_sha: LEGACY_CARRIER.into(),
                    latest_sha: "new".into(),
                }]),
            )
            .await
            .unwrap();
            assert!(result.errors[0].contains("demo: [baselineConflict]"));
            assert_eq!(fs::read(lock_path()).unwrap(), lock_before);
            assert_eq!(
                directory_bytes(&config::get_agents_skills_dir().join("demo")),
                dir_before
            );
            tree_mock.assert_async().await;
            archive_mock.assert_async().await;
        })
    });
}

#[test]
fn checked_request_with_pre_alignment_current_sha_refuses_after_alignment() {
    isolated(|| {
        runtime().block_on(async {
            install("demo", b"---\nname: demo\n---\nold body");
            // Local content matches the mirror; a request captured before the
            // alignment carries the stale carrier as current_sha.
            let local_sha = write_conflicted_entry_matching_mirror("demo", LEGACY_CARRIER);
            let state = state(&["demo"]);
            let mut server = mockito::Server::new_async().await;
            let tree_mock = tree(&mut server, 0).await;
            let archive_mock = archive(&mut server, 0).await;
            let _network = network(&server.url());

            let result = update_all_skills_inner(
                &state,
                Some(vec![CheckedSkillUpdate {
                    skill_name: "demo".into(),
                    current_sha: LEGACY_CARRIER.into(),
                    latest_sha: "new".into(),
                }]),
            )
            .await
            .unwrap();
            // The request is refused as stale, but the independent verified
            // alignment is still recorded: a later refusal does not undo it.
            assert!(result.errors[0].contains("demo: [updateStateChanged]"));
            assert!(!result.updated.contains(&"demo".to_string()));
            let lock = SkillLock::read().unwrap();
            assert_eq!(
                lock.skills["demo"].skill_folder_hash.as_deref(),
                Some(local_sha.as_str())
            );
            assert_eq!(
                lock.skills["demo"].commit_sha.as_deref(),
                Some(local_sha.as_str())
            );
            tree_mock.assert_async().await;
            archive_mock.assert_async().await;
        })
    });
}

#[test]
fn single_update_resolves_field_evidenced_conflict_and_updates() {
    isolated(|| {
        runtime().block_on(async {
            install("demo", b"---\nname: demo\n---\nold body");
            // Replicates the reported failure: gh recorded the carrier, the
            // pre-dual-baseline app update rewrote the mirror, local content
            // matches the mirror. The same request used to fail with
            // "Baseline records disagree".
            write_conflicted_entry_matching_mirror("demo", LEGACY_CARRIER);
            let state = state(&["demo"]);
            let mut server = mockito::Server::new_async().await;
            let tree_mock = tree(&mut server, 1).await;
            let archive_mock = archive(&mut server, 1).await;
            let _network = network(&server.url());

            let result = update_skill_inner(&state, "repo:owner/repo:demo".to_string())
                .await
                .unwrap();
            assert!(result.updated);
            let lock = SkillLock::read().unwrap();
            assert_eq!(
                lock.skills["demo"].skill_folder_hash.as_deref(),
                Some("new")
            );
            assert_eq!(lock.skills["demo"].commit_sha.as_deref(), Some("new"));
            assert!(fs::read_to_string(
                config::get_agents_skills_dir()
                    .join("demo")
                    .join("SKILL.md")
            )
            .unwrap()
            .ends_with("new body"));
            tree_mock.assert_async().await;
            archive_mock.assert_async().await;
        })
    });
}

#[test]
fn externally_pinned_conflict_never_gets_aligned() {
    isolated(|| {
        runtime().block_on(async {
            install("demo", b"---\nname: demo\n---\nold body");
            write_conflicted_entry_matching_mirror("demo", LEGACY_CARRIER);
            SkillLock::update(|lock| {
                lock.skills.get_mut("demo").unwrap().pinned_ref = Some("v1".into());
                Ok(())
            })
            .unwrap();
            let state = state(&["demo"]);
            let lock_before = fs::read(lock_path()).unwrap();
            let mut server = mockito::Server::new_async().await;
            let tree_mock = tree(&mut server, 0).await;
            let archive_mock = archive(&mut server, 0).await;
            let _network = network(&server.url());

            // Check: pinned entries are skipped without alignment or fetch.
            let check = check_skill_updates().await.unwrap();
            assert_eq!(
                check.skills[0].check_error_code.as_deref(),
                Some("externallyPinned")
            );
            // Batch update: the pin refusal fires first.
            let result = update_all_skills_inner(&state, None).await.unwrap();
            assert!(result.errors[0].contains("demo: [externallyPinned]"));
            // The recorded fields are unchanged by update operations (E1):
            // the carrier still holds the installer tree, the mirror the
            // verified local tree — no alignment, no rewrite.
            let lock = SkillLock::read().unwrap();
            let verified = crate::services::lock::content_tree_sha(
                &config::get_agents_skills_dir().join("demo"),
            )
            .unwrap();
            assert_eq!(
                lock.skills["demo"].skill_folder_hash.as_deref(),
                Some(LEGACY_CARRIER)
            );
            assert_eq!(
                lock.skills["demo"].commit_sha.as_deref(),
                Some(verified.as_str())
            );
            assert_eq!(lock.skills["demo"].pinned_ref.as_deref(), Some("v1"));
            assert_eq!(fs::read(lock_path()).unwrap(), lock_before);
            tree_mock.assert_async().await;
            archive_mock.assert_async().await;
        })
    });
}

#[test]
fn alignment_skips_entry_changed_since_measurement() {
    isolated(|| {
        install("demo", b"---\nname: demo\n---\nold body");
        // Field shape: carrier stale, mirror the verified local content.
        let local_sha = write_conflicted_entry_matching_mirror("demo", LEGACY_CARRIER);
        // Another writer changes the recorded carrier after the resolver read
        // it; the alignment must not overwrite that write with its old pair.
        SkillLock::update(|lock| {
            lock.skills.get_mut("demo").unwrap().skill_folder_hash = Some(LEGACY_MIRROR.into());
            Ok(())
        })
        .unwrap();

        let applied = SkillLock::apply_verified_alignments(&[VerifiedAlignment {
            lock_key: "demo".into(),
            carrier: LEGACY_CARRIER.into(),
            mirror: local_sha.clone(),
            verified: local_sha.clone(),
        }])
        .unwrap();
        assert!(applied.is_empty());

        let lock = SkillLock::read().unwrap();
        assert_eq!(
            lock.skills["demo"].skill_folder_hash.as_deref(),
            Some(LEGACY_MIRROR)
        );
        assert_eq!(
            lock.skills["demo"].commit_sha.as_deref(),
            Some(local_sha.as_str())
        );
    });
}

#[test]
fn alignment_is_idempotent_across_repeated_checks() {
    isolated(|| {
        runtime().block_on(async {
            install("demo", b"---\nname: demo\n---\nold body");
            write_conflicted_entry_matching_mirror("demo", LEGACY_CARRIER);
            let mut server = mockito::Server::new_async().await;
            // Both checks fetch the repo: the aligned entry participates like
            // any unconflicted skill.
            let tree_mock = tree(&mut server, 2).await;
            let _network = network(&server.url());

            let check = check_skill_updates().await.unwrap();
            assert_eq!(check.skills[0].baseline_state, "ok");
            let lock = SkillLock::read().unwrap();
            let aligned = lock.skills["demo"].skill_folder_hash.clone().unwrap();
            assert_eq!(
                lock.skills["demo"].commit_sha.as_deref(),
                Some(aligned.as_str())
            );
            let lock_after_first = fs::read(lock_path()).unwrap();

            // A repeated check finds the carriers agreeing and makes no
            // further lock write: the alignment is a one-time measured fact,
            // not a recurring rewrite.
            let check = check_skill_updates().await.unwrap();
            assert_eq!(check.skills[0].baseline_state, "ok");
            assert_eq!(fs::read(lock_path()).unwrap(), lock_after_first);
            tree_mock.assert_async().await;
        })
    });
}

#[test]
fn unreadable_check_and_forged_checked_requests_are_distinct_from_tracking() {
    isolated(|| {
        runtime().block_on(async {
            install("demo", b"---\nname: demo\nmetadata: [\n---\nbody");
            let state = state(&["demo"]);
            let before = fs::read(lock_path()).unwrap();
            let result = check_skill_updates().await.unwrap();
            assert_eq!(
                result.skills[0].check_error_code.as_deref(),
                Some("skillProvenanceUnreadable")
            );
            assert!(!result.skills[0].has_update);
            let result = update_all_skills_inner(
                &state,
                Some(vec![CheckedSkillUpdate {
                    skill_name: "demo".into(),
                    current_sha: "old".into(),
                    latest_sha: "new".into(),
                }]),
            )
            .await
            .unwrap();
            assert!(result.errors[0].contains("[skillProvenanceUnreadable]"));
            assert_eq!(fs::read(lock_path()).unwrap(), before);
        })
    });
}

#[test]
fn download_barrier_rejects_injected_tracking_and_changed_text_without_rollback() {
    for replacement in [
        fixture("gh-injected.md"),
        b"externally edited body".to_vec(),
    ] {
        isolated(|| {
            runtime().block_on(async {
                install("demo", b"---\nname: demo\n---\nold body");
                let state = state(&["demo"]);
                let lock_before = fs::read(lock_path()).unwrap();
                let dir = config::get_agents_skills_dir().join("demo");
                let entered = std::sync::Arc::new(std::sync::Barrier::new(2));
                let release = std::sync::Arc::new(std::sync::Barrier::new(2));
                let (a, b) = (entered.clone(), release.clone());
                let target = dir.clone();
                let writer = std::thread::spawn(move || {
                    a.wait();
                    fs::write(target.join("SKILL.md"), replacement).unwrap();
                    let after = directory_bytes(&target);
                    b.wait();
                    after
                });
                let mut server = mockito::Server::new_async().await;
                let tree = tree(&mut server, 1).await;
                let archive = server
                    .mock("GET", "/owner/repo/archive/refs/heads/main.zip")
                    .expect(1)
                    .with_status(200)
                    .with_body_from_request(move |_| {
                        entered.wait();
                        release.wait();
                        zip()
                    })
                    .create_async()
                    .await;
                let _network = network(&server.url());
                let result = update_all_skills_inner(&state, None).await.unwrap();
                assert_eq!(result.fail_count, 1);
                assert_eq!(result.success_count, 0);
                assert!(
                    result.errors[0].contains("[updateStateChanged]"),
                    "{:?}",
                    result.errors
                );
                assert_eq!(directory_bytes(&dir), writer.join().unwrap());
                assert_eq!(fs::read(lock_path()).unwrap(), lock_before);
                tree.assert_async().await;
                archive.assert_async().await;
            })
        });
    }
}

#[test]
fn all_unsafe_yaml_cases_refuse_direct_updates_without_writes() {
    isolated(|| {
        runtime().block_on(async {
            let cases: serde_json::Value =
                serde_json::from_slice(&fixture("gh-update-guard-cases.json")).unwrap();
            for case in cases
                .as_array()
                .unwrap()
                .iter()
                .filter(|case| case["expected"] != "Absent")
            {
                install("demo", case["text"].as_str().unwrap().as_bytes());
                let before = directory_bytes(&config::get_agents_skills_dir());
                let lock_before = fs::read(lock_path()).unwrap();
                let result = CliService::update_known_skill_entries(vec![KnownSkillUpdate {
                    install_directory: "demo".into(),
                    lock_key: "demo".into(),
                    entry: entry(),
                    latest_sha: "new".into(),
                }])
                .await
                .unwrap();
                let code = if case["expected"] == "Tracking" {
                    "ghProvenanceProtected"
                } else {
                    "skillProvenanceUnreadable"
                };
                assert_eq!(result.fail_count, 1, "{}", case["name"]);
                assert!(
                    result.errors[0].contains(code),
                    "{}: {:?}",
                    case["name"],
                    result.errors
                );
                assert_eq!(before, directory_bytes(&config::get_agents_skills_dir()));
                assert_eq!(lock_before, fs::read(lock_path()).unwrap());
            }
        })
    });
}

#[test]
fn final_recheck_discards_staging_and_keeps_external_edit() {
    isolated(|| {
        runtime().block_on(async {
            install("demo", b"---\nname: demo\n---\nold");
            let dir = config::get_agents_skills_dir().join("demo");
            let edited = fixture("gh-injected.md");
            let target = dir.clone();
            let bytes = edited.clone();
            TEST_BEFORE_UPDATE_REPLACE.with(|v| {
                *v.borrow_mut() = Some(Box::new(move || {
                    fs::write(target.join("SKILL.md"), bytes).unwrap();
                }))
            });
            let before = fs::read(lock_path()).unwrap();
            let mut server = mockito::Server::new_async().await;
            let zip = archive(&mut server, 1).await;
            let _network = network(&server.url());
            let result = CliService::update_known_skill_entries(vec![KnownSkillUpdate {
                install_directory: "demo".into(),
                lock_key: "demo".into(),
                entry: entry(),
                latest_sha: "new".into(),
            }])
            .await
            .unwrap();
            assert_eq!(result.fail_count, 1);
            assert!(result.errors[0].contains("[updateStateChanged]"));
            assert_eq!(fs::read(dir.join("SKILL.md")).unwrap(), edited);
            assert_eq!(fs::read(lock_path()).unwrap(), before);
            assert_eq!(
                fs::read_dir(config::get_agents_skills_dir())
                    .unwrap()
                    .count(),
                1
            );
            zip.assert_async().await;
        })
    });
}

#[test]
fn single_tree_barrier_preserves_original_authorization() {
    isolated(|| {
        runtime().block_on(async {
            install("demo", b"---\nname: demo\n---\nold");
            let state = state(&["demo"]);
            let id = state
                .skill_cache
                .read()
                .unwrap()
                .iter()
                .next()
                .unwrap()
                .id
                .clone();
            let before = fs::read(lock_path()).unwrap();
            let target = config::get_agents_skills_dir().join("demo/SKILL.md");
            let entered = std::sync::Arc::new(std::sync::Barrier::new(2));
            let release = std::sync::Arc::new(std::sync::Barrier::new(2));
            let (a, b) = (entered.clone(), release.clone());
            let writer = std::thread::spawn(move || {
                a.wait();
                fs::write(&target, b"external edit").unwrap();
                b.wait();
            });
            let mut server = mockito::Server::new_async().await;
            let tree = server
                .mock("GET", "/repos/owner/repo/git/trees/main?recursive=1")
                .expect(1)
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body_from_request(move |_| {
                    entered.wait();
                    release.wait();
                    br#"{"sha":"root","tree":[{"type":"tree","path":"skills/demo","sha":"new"}]}"#
                        .to_vec()
                })
                .create_async()
                .await;
            let zip = archive(&mut server, 0).await;
            let _network = network(&server.url());
            let result = update_skill_inner(&state, id).await.unwrap_err();
            writer.join().unwrap();
            assert_eq!(result.code, "updateStateChanged");
            assert_eq!(
                fs::read(config::get_agents_skills_dir().join("demo/SKILL.md")).unwrap(),
                b"external edit"
            );
            assert_eq!(fs::read(lock_path()).unwrap(), before);
            tree.assert_async().await;
            zip.assert_async().await;
        })
    });
}

#[test]
fn checked_request_after_tracking_injection_is_refused_and_priority_preserves_baseline_fields() {
    isolated(|| {
        runtime().block_on(async {
            install("demo", b"---\nname: demo\n---\nold");
            let state = state(&["demo"]);
            let mut server = mockito::Server::new_async().await;
            let tree = tree(&mut server, 1).await;
            let zip = archive(&mut server, 0).await;
            let _network = network(&server.url());
            let checked = check_skill_updates().await.unwrap();
            assert!(checked.skills[0].has_update);
            fs::write(
                config::get_agents_skills_dir().join("demo/SKILL.md"),
                fixture("gh-injected.md"),
            )
            .unwrap();
            let before = fs::read(lock_path()).unwrap();
            let result = update_all_skills_inner(
                &state,
                Some(vec![CheckedSkillUpdate {
                    skill_name: "demo".into(),
                    current_sha: "old".into(),
                    latest_sha: "new".into(),
                }]),
            )
            .await
            .unwrap();
            assert!(result.errors[0].contains("[ghProvenanceProtected]"));
            assert_eq!(fs::read(lock_path()).unwrap(), before);
            tree.assert_async().await;
            zip.assert_async().await;
            SkillLock::update(|lock| {
                let entry = lock.skills.get_mut("demo").unwrap();
                entry.pinned_ref = Some("v1".into());
                entry.commit_sha = Some("conflicting".into());
                entry.source = Some("invalid-source".into());
                Ok(())
            })
            .unwrap();
            let before = fs::read(lock_path()).unwrap();
            let status = check_skill_updates().await.unwrap().skills.remove(0);
            assert_eq!(
                status.check_error_code.as_deref(),
                Some("ghProvenanceProtected")
            );
            assert_eq!(status.baseline_state, "conflict");
            assert!(status.pinned);
            assert!(!status.has_update);
            assert_eq!(fs::read(lock_path()).unwrap(), before);
        })
    });
}

#[test]
fn directory_identity_change_is_refused_even_with_identical_skill_bytes() {
    isolated(|| {
        runtime().block_on(async {
            install("demo", b"---\nname: demo\n---\nold");
            let target = config::get_agents_skills_dir().join("demo");
            let original = fs::read(target.join("SKILL.md")).unwrap();
            let replacement = target.clone();
            TEST_BEFORE_UPDATE_REPLACE.with(|v| {
                *v.borrow_mut() = Some(Box::new(move || {
                    fs::rename(&replacement, replacement.with_file_name("saved")).unwrap();
                    fs::create_dir(&replacement).unwrap();
                    fs::write(replacement.join("SKILL.md"), &original).unwrap();
                    fs::write(replacement.join("external.txt"), "keep").unwrap();
                }))
            });
            let before = fs::read(lock_path()).unwrap();
            let mut server = mockito::Server::new_async().await;
            let zip = archive(&mut server, 1).await;
            let _network = network(&server.url());
            let result = CliService::update_known_skill_entries(vec![KnownSkillUpdate {
                install_directory: "demo".into(),
                lock_key: "demo".into(),
                entry: entry(),
                latest_sha: "new".into(),
            }])
            .await
            .unwrap();
            assert!(result.errors[0].contains("[updateStateChanged]"));
            assert_eq!(fs::read(target.join("external.txt")).unwrap(), b"keep");
            assert_eq!(fs::read(lock_path()).unwrap(), before);
            assert_eq!(
                fs::read_dir(config::get_agents_skills_dir())
                    .unwrap()
                    .count(),
                2
            );
            zip.assert_async().await;
        })
    });
}

#[cfg(unix)]
#[test]
fn permission_denial_is_unreadable_not_absent() {
    use std::os::unix::fs::PermissionsExt;
    isolated(|| {
        install("demo", b"ordinary");
        let file = config::get_agents_skills_dir().join("demo/SKILL.md");
        fs::set_permissions(&file, fs::Permissions::from_mode(0)).unwrap();
        let state = read_gh_tracking(file.parent().unwrap());
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(matches!(state, Provenance::Unreadable(_)));
    });
}

#[test]
fn single_guard_is_independent_of_missing_or_namespaced_lock_association() {
    for namespaced in [true, false] {
        isolated(|| {
            runtime().block_on(async {
                install("demo", &fixture("gh-injected.md"));
                let state = state(&["demo"]);
                let id = state
                    .skill_cache
                    .read()
                    .unwrap()
                    .iter()
                    .next()
                    .unwrap()
                    .id
                    .clone();
                if namespaced {
                    SkillLock::update(|lock| {
                        let entry = lock.skills.remove("demo").unwrap();
                        lock.skills.insert("author/demo".into(), entry);
                        Ok(())
                    })
                    .unwrap();
                } else {
                    fs::remove_file(lock_path()).unwrap();
                }
                let before = fs::read(lock_path()).ok();
                let files = directory_bytes(&config::get_agents_skills_dir());
                let error = update_skill_inner(&state, id).await.unwrap_err();
                assert_eq!(error.code, "ghProvenanceProtected");
                assert_eq!(fs::read(lock_path()).ok(), before);
                assert_eq!(directory_bytes(&config::get_agents_skills_dir()), files);
            })
        });
    }
}

#[test]
fn b1_historical_leaf_single_all_and_check_checked_update_the_physical_slot() {
    for mode in ["single", "all", "checked"] {
        for remote_path in ["skills/demo", "skills/demo/SKILL.md"] {
            isolated(|| {
                runtime().block_on(async {
                    install(
                        ".system/demo",
                        b"---\nname: demo\ndescription: demo\n---\nold body",
                    );
                    SkillLock::update(|lock| {
                        let mut old = lock.skills.remove(".system/demo").unwrap();
                        old.skill_path = Some(remote_path.into());
                        lock.skills.insert("demo".into(), old);
                        // A dangling record must not become a Check target.
                        lock.skills.insert("dangling".into(), entry());
                        Ok(())
                    })
                    .unwrap();
                    let state = state(&[".system/demo"]);
                    let id = state
                        .skill_cache
                        .read()
                        .unwrap()
                        .iter()
                        .next()
                        .unwrap()
                        .id
                        .clone();
                    let mut server = mockito::Server::new_async().await;
                    let tree_mock = tree(&mut server, 1).await;
                    let zip_mock = archive(&mut server, 1).await;
                    let _network = network(&server.url());
                    match mode {
                        "single" => {
                            assert!(update_skill_inner(&state, id).await.unwrap().updated);
                        }
                        "all" => {
                            let result = update_all_skills_inner(&state, None).await.unwrap();
                            assert_eq!(result.updated, vec![".system/demo"]);
                            assert!(result.errors.is_empty(), "{:?}", result.errors);
                        }
                        _ => {
                            let before = fs::read(lock_path()).unwrap();
                            let check = check_skill_updates().await.unwrap();
                            assert_eq!(check.skills.len(), 1);
                            let status = &check.skills[0];
                            assert_eq!(status.skill_name, ".system/demo");
                            assert!(status.has_update);
                            assert_eq!(before, fs::read(lock_path()).unwrap());
                            let result = update_all_skills_inner(
                                &state,
                                Some(vec![CheckedSkillUpdate {
                                    skill_name: status.skill_name.clone(),
                                    current_sha: status.current_sha.clone().unwrap(),
                                    latest_sha: status.latest_sha.clone().unwrap(),
                                }]),
                            )
                            .await
                            .unwrap();
                            assert_eq!(result.updated, vec![".system/demo"]);
                            assert!(result.errors.is_empty(), "{:?}", result.errors);
                        }
                    }
                    let lock = SkillLock::read().unwrap();
                    assert_eq!(lock.skills.len(), 2);
                    assert_eq!(lock.skills["demo"].recorded_baseline(), Some("new"));
                    assert_eq!(lock.skills["demo"].commit_sha.as_deref(), Some("new"));
                    assert_eq!(lock.skills["demo"].skill_path.as_deref(), Some(remote_path));
                    assert!(!config::get_agents_skills_dir().join("demo").exists());
                    assert!(fs::read_to_string(
                        config::get_agents_skills_dir().join(".system/demo/SKILL.md")
                    )
                    .unwrap()
                    .contains("new body"));
                    assert_eq!(
                        SkillService::scan_single_skill(".system/demo")
                            .unwrap()
                            .repo_owner
                            .as_deref(),
                        Some("owner")
                    );
                    tree_mock.assert_async().await;
                    zip_mock.assert_async().await;
                })
            });
        }
    }
}

#[test]
fn b1_network_barrier_lock_changes_refuse_before_replacement() {
    for change in ["source", "rekey", "competitor"] {
        isolated(|| {
            runtime().block_on(async {
                install(
                    ".system/demo",
                    b"---\nname: demo\ndescription: demo\n---\nold body",
                );
                SkillLock::update(|lock| {
                    let entry = lock.skills.remove(".system/demo").unwrap();
                    lock.skills.insert("demo".into(), entry);
                    Ok(())
                })
                .unwrap();
                let state = state(&[".system/demo"]);
                let before_dir = directory_bytes(&config::get_agents_skills_dir());
                let entered = std::sync::Arc::new(std::sync::Barrier::new(2));
                let release = std::sync::Arc::new(std::sync::Barrier::new(2));
                let (a, b) = (entered.clone(), release.clone());
                let target_lock = lock_path();
                let writer = std::thread::spawn(move || {
                    a.wait();
                    let mut lock: SkillLock =
                        serde_json::from_slice(&fs::read(&target_lock).unwrap()).unwrap();
                    match change {
                        "source" => {
                            lock.skills.get_mut("demo").unwrap().source = Some("other/repo".into())
                        }
                        "rekey" => {
                            let entry = lock.skills.remove("demo").unwrap();
                            lock.skills.insert(".system/demo".into(), entry);
                        }
                        _ => {
                            lock.skills
                                .insert(".system/demo".into(), lock.skills["demo"].clone());
                        }
                    }
                    lock.write_to(&target_lock).unwrap();
                    let after = fs::read(target_lock).unwrap();
                    b.wait();
                    after
                });
                let mut server = mockito::Server::new_async().await;
                let tree_mock = tree(&mut server, 1).await;
                let zip_mock = server
                    .mock("GET", "/owner/repo/archive/refs/heads/main.zip")
                    .expect(1)
                    .with_status(200)
                    .with_body_from_request(move |_| {
                        entered.wait();
                        release.wait();
                        zip()
                    })
                    .create_async()
                    .await;
                let _network = network(&server.url());
                let result = update_all_skills_inner(&state, None).await.unwrap();
                assert_eq!(result.success_count, 0);
                assert!(
                    result.errors[0].contains("updateStateChanged"),
                    "{:?}",
                    result.errors
                );
                assert_eq!(
                    directory_bytes(&config::get_agents_skills_dir()),
                    before_dir
                );
                assert_eq!(fs::read(lock_path()).unwrap(), writer.join().unwrap());
                tree_mock.assert_async().await;
                zip_mock.assert_async().await;
            })
        });
    }
}

#[test]
fn b1_duplicate_remote_leaves_use_recorded_path_or_refuse_missing_path() {
    for skill_path in [Some("second/demo"), Some("second/demo/SKILL.md"), None] {
        isolated(|| {
            runtime().block_on(async {
            install("demo", b"---\nname: demo\ndescription: demo\n---\nold body");
            SkillLock::update(|lock| { lock.skills.get_mut("demo").unwrap().skill_path = skill_path.map(str::to_string); Ok(()) }).unwrap();
            let state = state(&["demo"]);
            let before = fs::read(lock_path()).unwrap();
            let before_dir = directory_bytes(&config::get_agents_skills_dir());
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
            for (directory, body) in [("first/demo", "wrong body"), ("second/demo", "chosen body")] {
                writer.start_file(format!("repo-main/{directory}/SKILL.md"), zip::write::SimpleFileOptions::default()).unwrap();
                writer.write_all(format!("---\nname: demo\ndescription: test\n---\n{body}").as_bytes()).unwrap();
            }
            let bytes = writer.finish().unwrap().into_inner();
            let mut server = mockito::Server::new_async().await;
            let tree_mock = server.mock("GET", "/repos/owner/repo/git/trees/main?recursive=1").expect(1).with_status(200)
                .with_header("content-type", "application/json").with_body(r#"{"sha":"new-root","tree":[{"type":"tree","path":"first/demo","sha":"wrong"},{"type":"tree","path":"second/demo","sha":"new"}]}"#).create_async().await;
            let zip_mock = server.mock("GET", "/owner/repo/archive/refs/heads/main.zip").expect(1).with_status(200).with_body(bytes).create_async().await;
            let _network = network(&server.url());
            let result = update_all_skills_inner(&state, None).await.unwrap();
            if skill_path.is_some() {
                assert_eq!(result.updated, vec!["demo"], "{:?}", result.errors);
                assert!(fs::read_to_string(config::get_agents_skills_dir().join("demo/SKILL.md")).unwrap().contains("chosen body"));
                assert_eq!(SkillLock::read().unwrap().skills["demo"].recorded_baseline(), Some("new"));
            } else {
                assert_eq!(result.success_count, 0);
                assert_eq!(result.fail_count, 1);
                assert_eq!(fs::read(lock_path()).unwrap(), before);
                assert_eq!(directory_bytes(&config::get_agents_skills_dir()), before_dir);
            }
            tree_mock.assert_async().await;
            zip_mock.assert_async().await;
        })
        });
    }
}
