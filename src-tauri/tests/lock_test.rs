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
        extra: Default::default(),
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

#[test]
fn test_content_baseline_ignores_missing_and_empty_hash() {
    let mut entry = make_lock_entry("anthropics/skills");
    entry.skill_folder_hash = None;
    assert_eq!(entry.content_baseline(), None);
    entry.skill_folder_hash = Some(String::new());
    assert_eq!(entry.content_baseline(), None);
    // Legacy writers stored the 40-character git SHA; it is not a usable
    // baseline and must never produce a permanent false drift report.
    entry.skill_folder_hash = Some("72258d6496ccd708fb946591d944282d6de03f13".to_string());
    assert_eq!(entry.content_baseline(), None);
    entry.skill_folder_hash =
        Some("8293DB63637957643ABB559A59C1122EF387E21F61B60E8B0B3B2DFDA73BAE36".to_string());
    assert_eq!(entry.content_baseline(), None);
    entry.skill_folder_hash =
        Some("8293db63637957643abb559a59c1122ef387e21f61b60e8b0b3b2dfda73bae36".to_string());
    assert_eq!(
        entry.content_baseline(),
        Some("8293db63637957643abb559a59c1122ef387e21f61b60e8b0b3b2dfda73bae36")
    );
}

#[test]
fn test_skill_folder_hash_is_deterministic_and_content_sensitive() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let root = tmp.path().join("demo");
    std::fs::create_dir_all(root.join("references")).expect("mkdir");
    std::fs::write(root.join("SKILL.md"), "# demo\n").expect("write");
    std::fs::write(root.join("references/notes.md"), "notes").expect("write");

    let first = skill_zoo_lib::services::lock::compute_skill_folder_hash(&root).expect("hash");
    let second = skill_zoo_lib::services::lock::compute_skill_folder_hash(&root).expect("hash");
    assert_eq!(first, second);
    assert_eq!(first.len(), 64);

    std::fs::write(root.join("references/notes.md"), "notes v2").expect("rewrite");
    let changed = skill_zoo_lib::services::lock::compute_skill_folder_hash(&root).expect("hash");
    assert_ne!(first, changed);

    // Renaming a file moves the baseline even with identical content.
    std::fs::rename(root.join("references/notes.md"), root.join("notes.md")).expect("rename");
    let renamed = skill_zoo_lib::services::lock::compute_skill_folder_hash(&root).expect("hash");
    assert_ne!(first, renamed);
    assert_ne!(changed, renamed);
}

#[test]
fn test_skill_folder_hash_skips_symlinks_without_following() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let root = tmp.path().join("demo");
    std::fs::create_dir_all(&root).expect("mkdir");
    std::fs::write(root.join("SKILL.md"), "# demo\n").expect("write");

    let outside = tmp.path().join("outside.md");
    std::fs::write(&outside, "secret").expect("write");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, root.join("leaked.md")).expect("symlink");

    let hash = skill_zoo_lib::services::lock::compute_skill_folder_hash(&root).expect("hash");
    let baseline = skill_zoo_lib::services::lock::compute_skill_folder_hash(&root).expect("hash");
    assert_eq!(hash, baseline);

    // Changing the symlink target does not move the baseline...
    std::fs::write(&outside, "rotated").expect("rewrite");
    let after_target_change =
        skill_zoo_lib::services::lock::compute_skill_folder_hash(&root).expect("hash");
    assert_eq!(hash, after_target_change);

    // ...and a drifted check against the untouched baseline reports no drift.
    let mut entry = make_lock_entry("anthropics/skills");
    entry.skill_folder_hash = Some(hash);
    assert!(!skill_zoo_lib::services::lock::skill_folder_drifted(
        &root, &entry
    ));
}

#[test]
fn test_skill_folder_hash_ignores_os_metadata_files() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let root = tmp.path().join("demo");
    std::fs::create_dir_all(&root).expect("mkdir");
    std::fs::write(root.join("SKILL.md"), "# demo\n").expect("write");

    let baseline = skill_zoo_lib::services::lock::compute_skill_folder_hash(&root).expect("hash");

    // Browsing the folder in Finder or Explorer drops metadata files that are
    // not skill content; they must not claim the user edited the skill.
    std::fs::write(root.join(".DS_Store"), "finder").expect("write");
    std::fs::write(root.join("Thumbs.db"), "explorer").expect("write");
    let after_metadata =
        skill_zoo_lib::services::lock::compute_skill_folder_hash(&root).expect("hash");

    assert_eq!(baseline, after_metadata);
    let mut entry = make_lock_entry("anthropics/skills");
    entry.skill_folder_hash = Some(baseline);
    assert!(!skill_zoo_lib::services::lock::skill_folder_drifted(
        &root, &entry
    ));
}

#[test]
fn test_skill_folder_drifted_requires_baseline_and_evidence() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let root = tmp.path().join("demo");
    std::fs::create_dir_all(&root).expect("mkdir");
    std::fs::write(root.join("SKILL.md"), "# demo\n").expect("write");

    // Unknown baselines never report drift.
    let mut entry = make_lock_entry("anthropics/skills");
    entry.skill_folder_hash = None;
    assert!(!skill_zoo_lib::services::lock::skill_folder_drifted(
        &root, &entry
    ));
    entry.skill_folder_hash = Some(String::new());
    assert!(!skill_zoo_lib::services::lock::skill_folder_drifted(
        &root, &entry
    ));

    // A stale baseline over changed content does.
    entry.skill_folder_hash =
        Some("8293db63637957643abb559a59c1122ef387e21f61b60e8b0b3b2dfda73bae36".to_string());
    assert!(skill_zoo_lib::services::lock::skill_folder_drifted(
        &root, &entry
    ));

    // A missing folder cannot be judged either.
    assert!(!skill_zoo_lib::services::lock::skill_folder_drifted(
        &tmp.path().join("gone"),
        &entry
    ));
}
