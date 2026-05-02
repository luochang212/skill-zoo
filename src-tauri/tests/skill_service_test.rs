mod common;

use common::SkillService;

#[test]
fn test_extract_frontmatter_with_yaml() {
    let md = "---\nname: test\nversion: 1\n---\n\n# Hello";
    let result = SkillService::extract_frontmatter(md);
    assert_eq!(result, Some("name: test\nversion: 1".to_string()));
}

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
