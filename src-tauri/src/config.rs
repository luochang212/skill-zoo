use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;

pub const MAX_DOWNLOAD_BYTES: u64 = 500 * 1024 * 1024;

/// Directories to skip when scanning for skills.
/// Matches the upstream `npx skills` CLI: <https://github.com/vercel-labs/skills>
pub const SKIP_DIRS: &[&str] = &["node_modules", ".git", "dist", "build", "__pycache__"];

pub fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("skill-zoo")
            .build()
            .expect("Failed to create HTTP client")
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub id: &'static str,
    pub label: &'static str,
    pub skills_subdir: &'static str,
}

pub const AGENTS: &[AgentConfig] = &[
    AgentConfig {
        id: "claude-code",
        label: "Claude Code",
        skills_subdir: ".claude",
    },
    AgentConfig {
        id: "codex",
        label: "Codex",
        skills_subdir: ".codex",
    },
    AgentConfig {
        id: "gemini",
        label: "Gemini",
        skills_subdir: ".gemini",
    },
    AgentConfig {
        id: "opencode",
        label: "OpenCode",
        skills_subdir: ".opencode",
    },
    AgentConfig {
        id: "cursor",
        label: "Cursor",
        skills_subdir: ".cursor",
    },
    AgentConfig {
        id: "trae",
        label: "Trae",
        skills_subdir: ".trae",
    },
    AgentConfig {
        id: "trae-cn",
        label: "Trae CN",
        skills_subdir: ".trae-cn",
    },
    AgentConfig {
        id: "hermes",
        label: "Hermes",
        skills_subdir: ".hermes",
    },
    AgentConfig {
        id: "openclaw",
        label: "OpenClaw",
        skills_subdir: ".openclaw",
    },
    AgentConfig {
        id: "workbuddy",
        label: "WorkBuddy",
        skills_subdir: ".workbuddy",
    },
    AgentConfig {
        id: "qoder-cn",
        label: "Qoder CN",
        skills_subdir: ".qoder-cn",
    },
    AgentConfig {
        id: "qoderworkcn",
        label: "QoderWork CN",
        skills_subdir: ".qoderworkcn",
    },
];

pub fn default_visibility(agent_id: &str) -> bool {
    !matches!(
        agent_id,
        "trae" | "trae-cn" | "gemini" | "opencode" | "workbuddy" | "qoder-cn" | "qoderworkcn"
    )
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPathInfo {
    pub agent: String,
    pub label: String,
    pub path: String,
    pub exists: bool,
}

pub fn get_all_agent_paths() -> Vec<AgentPathInfo> {
    let mut paths = Vec::new();

    // SSOT path first
    let ssot_dir = get_agents_skills_dir();
    paths.push(AgentPathInfo {
        agent: "ssot".to_string(),
        label: "Skills Store".to_string(),
        path: ssot_dir.display().to_string(),
        exists: ssot_dir.exists(),
    });

    // Per-agent paths
    for agent in AGENTS {
        if let Some(dir) = get_agent_skills_dir(agent.id) {
            paths.push(AgentPathInfo {
                agent: agent.id.to_string(),
                label: agent.label.to_string(),
                path: dir.display().to_string(),
                exists: dir.exists(),
            });
        }
    }

    paths
}

pub fn get_app_config_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".skill-zoo")
}

pub fn get_repo_zip_cache_dir() -> PathBuf {
    get_app_config_dir().join("cache/repo-zips")
}

pub fn get_archive_dir() -> PathBuf {
    get_app_config_dir().join("archive")
}

pub fn get_archive_skills_dir() -> PathBuf {
    get_archive_dir().join("skills")
}

pub fn get_archive_manifest_file() -> PathBuf {
    get_archive_dir().join("manifest.json")
}

pub fn get_update_history_file() -> PathBuf {
    get_app_config_dir().join("skill-update-history.json")
}

pub fn get_agents_skills_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".agents")
        .join("skills")
}

pub fn get_agent_lock_file() -> PathBuf {
    get_agents_skills_dir()
        .parent()
        .map(|p| p.join(".skill-lock.json"))
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".agents")
                .join(".skill-lock.json")
        })
}

pub fn get_agent_skills_dir(agent_id: &str) -> Option<PathBuf> {
    if agent_id == "ssot" {
        return Some(get_agents_skills_dir());
    }
    let home = dirs::home_dir()?;
    let cfg = AGENTS.iter().find(|a| a.id == agent_id)?;
    Some(home.join(cfg.skills_subdir).join("skills"))
}
