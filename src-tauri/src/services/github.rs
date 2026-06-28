use crate::error::AppError;
use regex::Regex;
use std::sync::LazyLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubRepoRef {
    pub owner: String,
    pub name: String,
    pub branch: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubRepoQuery {
    pub owner: String,
    pub name: String,
    pub branch: Option<String>,
}

static REPO_SEGMENT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9_.-]+$").unwrap());

pub fn parse_repo_ref(input: &str) -> Result<GitHubRepoRef, AppError> {
    let query = parse_repo_query(input).map_err(AppError::BadRequest)?;
    Ok(GitHubRepoRef {
        owner: query.owner,
        name: query.name,
        branch: query.branch.unwrap_or_else(|| "main".to_string()),
    })
}

pub fn parse_repo_query(input: &str) -> Result<GitHubRepoQuery, String> {
    let input = input.trim();

    if input.starts_with("http://") || input.starts_with("https://") {
        let url = url::Url::parse(input).map_err(|e| format!("Invalid URL: {e}"))?;
        match url.host_str() {
            Some("github.com") => {}
            Some(host) => return Err(format!("Expected github.com URL, got host: {host}")),
            None => return Err("Invalid GitHub URL: no host".into()),
        }

        let segments: Vec<&str> = url
            .path_segments()
            .ok_or("Invalid GitHub URL: no path segments")?
            .collect();

        if segments.len() < 2 {
            return Err("GitHub URL must include owner/name".into());
        }

        let owner = segments[0].to_string();
        let name = segments[1].trim_end_matches(".git").to_string();
        let branch = if segments.len() >= 4 && segments[2] == "tree" {
            Some(segments[3].to_string())
        } else {
            None
        };

        validate_repo_segments(&owner, &name, branch.as_deref().unwrap_or("main"))?;
        Ok(GitHubRepoQuery {
            owner,
            name,
            branch,
        })
    } else {
        let parts: Vec<&str> = input.splitn(2, '/').collect();
        if parts.len() != 2 {
            return Err("Query must be in 'owner/name' format or a GitHub URL".into());
        }
        let owner = parts[0].to_string();
        let name = parts[1].trim_end_matches(".git").to_string();
        validate_repo_segments(&owner, &name, "main")?;
        Ok(GitHubRepoQuery {
            owner,
            name,
            branch: None,
        })
    }
}

pub fn validate_repo_segments(owner: &str, name: &str, branch: &str) -> Result<(), String> {
    let id_re = &REPO_SEGMENT_RE;
    if !id_re.is_match(owner) || !id_re.is_match(name) {
        return Err("Invalid owner or repository name format".into());
    }
    if branch.contains('\0') || branch.contains("..") || branch.len() > 255 {
        return Err("Invalid branch name format".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{parse_repo_query, parse_repo_ref};

    #[test]
    fn repo_ref_defaults_branch_to_main() {
        let repo_ref = parse_repo_ref("vercel-labs/skills").unwrap();

        assert_eq!(repo_ref.owner, "vercel-labs");
        assert_eq!(repo_ref.name, "skills");
        assert_eq!(repo_ref.branch, "main");
    }

    #[test]
    fn repo_ref_parses_github_urls_and_tree_branch() {
        let repo_ref = parse_repo_ref("https://github.com/anthropics/skills/tree/dev").unwrap();

        assert_eq!(repo_ref.owner, "anthropics");
        assert_eq!(repo_ref.name, "skills");
        assert_eq!(repo_ref.branch, "dev");
    }

    #[test]
    fn repo_ref_strips_dot_git() {
        let repo_ref = parse_repo_ref("https://github.com/anthropics/skills.git").unwrap();

        assert_eq!(repo_ref.owner, "anthropics");
        assert_eq!(repo_ref.name, "skills");
        assert_eq!(repo_ref.branch, "main");
    }

    #[test]
    fn repo_query_only_returns_a_branch_when_explicitly_provided() {
        let query = parse_repo_query("owner/repo").unwrap();
        assert_eq!(query.owner, "owner");
        assert_eq!(query.name, "repo");
        assert_eq!(query.branch, None);

        let query = parse_repo_query("https://github.com/owner/repo/tree/master").unwrap();
        assert_eq!(query.owner, "owner");
        assert_eq!(query.name, "repo");
        assert_eq!(query.branch.as_deref(), Some("master"));
    }

    #[test]
    fn parser_rejects_non_github_hosts_and_invalid_segments() {
        assert!(parse_repo_ref("https://gitlab.com/foo/bar").is_err());
        assert!(parse_repo_query("bad owner/repo").is_err());
        assert!(parse_repo_query("owner/repo/tree/bad..branch").is_err());
    }
}
