use crate::{config, services::github};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CatalogKind {
    Popular,
    Trending,
}

impl CatalogKind {
    fn slug(self) -> &'static str {
        match self {
            Self::Popular => "popular",
            Self::Trending => "trending",
        }
    }
    fn url(self) -> &'static str {
        match self {
            Self::Popular => "https://skills.sh/",
            Self::Trending => "https://skills.sh/trending",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSkill {
    source: String,
    skill_id: String,
    name: String,
    installs: u64,
    /// Weekly install counts as published by skills.sh; older cache files
    /// predate this field, hence the default.
    #[serde(default)]
    weekly_installs: Vec<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCatalog {
    skills: Vec<CatalogSkill>,
    fetched_at: u64,
    stale: bool,
}

fn read_skills(payload: &str) -> Option<Vec<CatalogSkill>> {
    let (_, rest) = payload.split_once("\"initialSkills\":")?;
    serde_json::Deserializer::from_str(rest)
        .into_iter::<Vec<CatalogSkill>>()
        .next()?
        .ok()
}

fn parse_catalog(body: &str) -> Result<Vec<CatalogSkill>, String> {
    // Decode Next's JSON payload as data; never evaluate upstream scripts.
    let skills = read_skills(body)
        .or_else(|| {
            body.split("self.__next_f.push(").skip(1).find_map(|part| {
                let payload = serde_json::Deserializer::from_str(part)
                    .into_iter::<(u8, String)>()
                    .next()?
                    .ok()?
                    .1;
                read_skills(&payload)
            })
        })
        .ok_or("skills.sh catalog format changed")?;
    let mut seen = HashSet::new();
    let skills: Vec<_> = skills
        .into_iter()
        .filter(|skill| {
            let Some((owner, repo)) = skill.source.split_once('/') else {
                return false;
            };
            !owner.contains('.')
                && github::validate_repo_segments(owner, repo, "HEAD").is_ok()
                && !skill.name.trim().is_empty()
                && skill
                    .skill_id
                    .bytes()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphanumeric())
                && skill.skill_id.len() <= 200
                && skill
                    .skill_id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
                && seen.insert((skill.source.to_ascii_lowercase(), skill.skill_id.clone()))
        })
        .take(600)
        .collect();
    if skills.is_empty() {
        return Err("skills.sh catalog contains no GitHub skills".into());
    }
    Ok(skills)
}

async fn fetch_catalog(kind: CatalogKind) -> Result<Vec<CatalogSkill>, String> {
    let mut response = config::http_client()
        .get(kind.url())
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if body.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err("Catalog response too large".into());
        }
        body.extend_from_slice(&chunk);
    }
    parse_catalog(std::str::from_utf8(&body).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn get_skill_catalog(
    app: tauri::AppHandle,
    kind: CatalogKind,
) -> Result<SkillCatalog, String> {
    let path = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join(format!("skills-sh-{}.json", kind.slug()));
    let cached = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<SkillCatalog>(&bytes).ok());
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    if let Some(ref catalog) = cached {
        if now.saturating_sub(catalog.fetched_at) < 3600 {
            return Ok(catalog.clone());
        }
    }
    match fetch_catalog(kind).await {
        Ok(skills) => {
            let catalog = SkillCatalog {
                skills,
                fetched_at: now,
                stale: false,
            };
            if let Ok(bytes) = serde_json::to_vec(&catalog) {
                if let Some(parent) = path.parent() {
                    if std::fs::create_dir_all(parent).is_ok() {
                        // Disposable cache: a failed write must not hide a successful fetch.
                        let _ = std::fs::write(&path, bytes);
                    }
                }
            }
            Ok(catalog)
        }
        Err(error) => cached
            .map(|mut catalog| {
                catalog.stale = true;
                catalog
            })
            .ok_or(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_html_payload_and_filters_sources_without_treating_slugs_as_paths() {
        let payload = r#"53:["$",null,{"initialSkills":[{"source":"owner/repo.v2","skillId":"test","name":"A \"quoted\" skill","installs":42,"weeklyInstalls":[10,20,30]},{"source":"owner/repo.v2","skillId":"test","name":"duplicate","installs":10},{"source":"site.com/skills","skillId":"test","name":"domain","installs":1},{"source":"owner/repo","skillId":"../bad","name":"bad","installs":1}]}]"#;
        let html = format!(
            "<script>self.__next_f.push([0])</script><script>self.__next_f.push({})</script>",
            serde_json::to_string(&(1, payload)).unwrap()
        );
        let skills = parse_catalog(&html).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "A \"quoted\" skill");
        assert_eq!(skills[0].installs, 42);
        assert_eq!(skills[0].weekly_installs, vec![10, 20, 30]);
    }
    #[tokio::test]
    #[ignore = "requires skills.sh network access"]
    async fn live_catalogs() {
        for kind in [CatalogKind::Popular, CatalogKind::Trending] {
            let skills = fetch_catalog(kind).await.unwrap();
            assert!(skills.len() > 12);
            println!("{}: {} GitHub skills", kind.slug(), skills.len());
        }
    }

    #[test]
    fn rejects_changed_or_empty_catalogs() {
        assert!(parse_catalog("<html>Unavailable</html>").is_err());
        assert!(parse_catalog(r#"{"initialSkills":[]}"#).is_err());
        assert!(parse_catalog(
            r#"{"initialSkills":[{"source":"a/b","skillId":"ok","name":"ok","installs":12}]}"#
        )
        .is_ok());
    }
}
