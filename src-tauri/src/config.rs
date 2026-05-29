use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};

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
];

pub fn default_visibility(agent_id: &str) -> bool {
    if agent_id.starts_with("custom-") {
        return true;
    }
    !matches!(agent_id, "trae" | "trae-cn" | "gemini" | "opencode")
}

// ── Custom Agent Support ──────────────────────────────────────────────

/// User-defined agent persisted to settings.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgentInfo {
    pub id: String,
    pub name: String,
    pub skills_dir: String,
}

/// Resolved agent item for iteration — skills_dir is pre-computed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentIterItem {
    pub id: String,
    pub label: String,
    pub skills_dir: PathBuf,
}

/// In-memory cache for custom agents to avoid repeated disk reads.
static CUSTOM_AGENTS_CACHE: OnceLock<RwLock<Option<Vec<CustomAgentInfo>>>> = OnceLock::new();

fn custom_agents_cache() -> &'static RwLock<Option<Vec<CustomAgentInfo>>> {
    CUSTOM_AGENTS_CACHE.get_or_init(|| RwLock::new(None))
}

/// Load custom agents from settings.json with in-memory cache.
/// Returns empty vec when no custom agents exist or on any error.
pub fn load_custom_agents() -> Vec<CustomAgentInfo> {
    let cache = custom_agents_cache();

    // Fast path: cache hit
    {
        let guard = cache.read().unwrap_or_else(|e| e.into_inner());
        if let Some(ref cached) = *guard {
            return cached.clone();
        }
    }

    // Slow path: read from disk
    let customs = read_custom_agents_from_disk();
    {
        let mut guard = cache.write().unwrap_or_else(|e| e.into_inner());
        *guard = Some(customs.clone());
    }
    customs
}

fn read_custom_agents_from_disk() -> Vec<CustomAgentInfo> {
    let path = get_app_config_dir().join("settings.json");
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    let Ok(root) = serde_json::from_str::<serde_json::Value>(&content) else {
        return Vec::new();
    };
    // Settings stores keys inside `values`; custom_agents is a JSON string
    let Some(raw) = root
        .get("values")
        .and_then(|v| v.get("custom_agents"))
        .and_then(|v| v.as_str())
    else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<CustomAgentInfo>>(raw).unwrap_or_default()
}

/// Invalidate the custom agents cache (call after add/remove).
pub fn invalidate_custom_agents_cache() {
    let mut guard = custom_agents_cache()
        .write()
        .unwrap_or_else(|e| e.into_inner());
    *guard = None;
}

/// Return a merged list of all agents (built-in + custom) with
/// pre-resolved `skills_dir`. Built-in agents are always first.
pub fn iter_all_agents(customs: &[CustomAgentInfo]) -> Vec<AgentIterItem> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut items: Vec<AgentIterItem> = AGENTS
        .iter()
        .map(|a| AgentIterItem {
            id: a.id.to_string(),
            label: a.label.to_string(),
            skills_dir: home.join(a.skills_subdir).join("skills"),
        })
        .collect();

    for c in customs.iter() {
        items.push(AgentIterItem {
            id: c.id.clone(),
            label: c.name.clone(),
            skills_dir: PathBuf::from(&c.skills_dir),
        });
    }

    items
}

/// Single entry point: all agents (built-in + custom) with pre-resolved paths.
/// Call this instead of the two-step `load_custom_agents()` + `iter_all_agents()`.
pub fn all_agents() -> Vec<AgentIterItem> {
    iter_all_agents(&load_custom_agents())
}

/// Look up a single agent's skills dir (built-in or custom).
pub fn resolve_agent_skills_dir(agent_id: &str) -> Option<PathBuf> {
    if agent_id == "ssot" {
        return Some(get_agents_skills_dir());
    }
    for item in all_agents() {
        if item.id == agent_id {
            return Some(item.skills_dir);
        }
    }
    None
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
    for agent in all_agents() {
        let exists = agent.skills_dir.exists();
        paths.push(AgentPathInfo {
            agent: agent.id,
            label: agent.label,
            path: agent.skills_dir.display().to_string(),
            exists,
        });
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
    resolve_agent_skills_dir(agent_id)
}
