mod common;

use common::SkillService;
use std::fs;

#[test]
fn test_remove_skill_dir_deletes_directory() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let skill_dir = tmp.path().join("test-skill");
    fs::create_dir(&skill_dir).expect("create dir");
    fs::write(skill_dir.join("SKILL.md"), "# Test").expect("write file");
    assert!(skill_dir.exists());

    SkillService::remove_skill_dir("test-skill", &skill_dir.to_string_lossy())
        .expect("remove_skill_dir should succeed");

    assert!(!skill_dir.exists(), "skill directory should be deleted");
}

#[test]
fn test_remove_skill_dir_non_existent_is_noop() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let nonexistent = tmp.path().join("does-not-exist");

    let result = SkillService::remove_skill_dir("does-not-exist", &nonexistent.to_string_lossy());
    assert!(result.is_ok(), "removing non-existent dir should not error");
}
