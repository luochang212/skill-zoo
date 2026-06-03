use skill_zoo_lib::commands::skill::is_path_under_skill_roots_for_test;
use std::fs;

#[test]
fn test_path_boundary_allows_real_file_under_root() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let root = tmp.path().join("skills");
    fs::create_dir(&root).expect("create root");
    let file = root.join("demo").join("SKILL.md");
    fs::create_dir(file.parent().expect("file parent")).expect("create skill dir");
    fs::write(&file, "# Demo").expect("write file");

    assert!(is_path_under_skill_roots_for_test(&file, &[root], true));
}

#[test]
fn test_path_boundary_allows_new_file_under_real_root() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let root = tmp.path().join("skills");
    let skill_dir = root.join("demo");
    fs::create_dir_all(&skill_dir).expect("create skill dir");
    let file = skill_dir.join("notes.md");

    assert!(is_path_under_skill_roots_for_test(&file, &[root], false));
}

#[cfg(unix)]
#[test]
fn test_path_boundary_rejects_symlink_file_escape() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let root = tmp.path().join("skills");
    let skill_dir = root.join("demo");
    let outside = tmp.path().join("outside.md");
    let link = skill_dir.join("linked.md");
    fs::create_dir_all(&skill_dir).expect("create skill dir");
    fs::write(&outside, "outside").expect("write outside file");
    std::os::unix::fs::symlink(&outside, &link).expect("create symlink");
    let roots = vec![root];

    assert!(!is_path_under_skill_roots_for_test(&link, &roots, true));
    assert!(!is_path_under_skill_roots_for_test(&link, &roots, false));
}

#[cfg(unix)]
#[test]
fn test_path_boundary_rejects_new_file_under_symlinked_directory_escape() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let root = tmp.path().join("skills");
    let skill_dir = root.join("demo");
    let outside_dir = tmp.path().join("outside");
    let link_dir = skill_dir.join("linked-dir");
    let escaped_file = link_dir.join("notes.md");
    fs::create_dir_all(&skill_dir).expect("create skill dir");
    fs::create_dir(&outside_dir).expect("create outside dir");
    std::os::unix::fs::symlink(&outside_dir, &link_dir).expect("create symlink dir");

    assert!(!is_path_under_skill_roots_for_test(
        &escaped_file,
        &[root],
        false
    ));
}

#[cfg(unix)]
#[test]
fn test_path_boundary_rejects_broken_symlink_file_for_writes() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let root = tmp.path().join("skills");
    let skill_dir = root.join("demo");
    let missing_outside = tmp.path().join("missing-outside.md");
    let link = skill_dir.join("broken.md");
    fs::create_dir_all(&skill_dir).expect("create skill dir");
    std::os::unix::fs::symlink(&missing_outside, &link).expect("create broken symlink");

    assert!(!is_path_under_skill_roots_for_test(&link, &[root], false));
}
