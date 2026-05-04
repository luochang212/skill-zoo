mod common;

use common::SkillService;

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
