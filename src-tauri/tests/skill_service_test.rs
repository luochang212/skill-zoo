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

#[test]
fn test_build_file_tree_level_does_not_recurse() {
    let dir = tempfile::tempdir().expect("tempdir");
    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir(&skill_dir).expect("create skill dir");
    std::fs::create_dir(skill_dir.join("examples")).expect("create examples dir");
    std::fs::create_dir(skill_dir.join("node_modules")).expect("create skipped dir");
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill").expect("write skill");
    std::fs::write(skill_dir.join("z.txt"), "z").expect("write root file");
    std::fs::write(skill_dir.join("examples").join("nested.md"), "nested").expect("write nested");
    std::fs::write(skill_dir.join("node_modules").join("package.json"), "{}")
        .expect("write skipped");

    let nodes = SkillService::build_file_tree_level_for_test(&skill_dir).expect("list level");
    let names: Vec<_> = nodes.iter().map(|node| node.name.as_str()).collect();

    assert_eq!(names, vec!["examples", "SKILL.md", "z.txt"]);
    let examples = nodes
        .iter()
        .find(|node| node.name == "examples")
        .expect("examples");
    assert!(examples.is_dir);
    assert!(examples.children.is_none());
    assert!(nodes
        .iter()
        .any(|node| node.name == "SKILL.md" && node.is_skill_md));
}
