use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, OnceLock, RwLock};

pub const MAX_DOWNLOAD_BYTES: u64 = 5 * 1024 * 1024 * 1024;

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
    pub id: String,
    pub label: String,
    pub skills_subdir: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skills_dir: Option<PathBuf>,
    pub has_usage_tracking: bool,
}

pub static AGENTS: LazyLock<Vec<AgentConfig>> = LazyLock::new(|| {
    vec![
        AgentConfig {
            id: "claude-code".into(),
            label: "Claude Code".into(),
            skills_subdir: ".claude".into(),
            skills_dir: None,
            has_usage_tracking: true,
        },
        AgentConfig {
            id: "codex".into(),
            label: "Codex".into(),
            skills_subdir: ".codex".into(),
            skills_dir: None,
            has_usage_tracking: true,
        },
        AgentConfig {
            id: "gemini".into(),
            label: "Gemini".into(),
            skills_subdir: ".gemini".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "opencode".into(),
            label: "OpenCode".into(),
            skills_subdir: ".opencode".into(),
            skills_dir: None,
            has_usage_tracking: true,
        },
        AgentConfig {
            id: "cursor".into(),
            label: "Cursor".into(),
            skills_subdir: ".cursor".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "trae".into(),
            label: "Trae".into(),
            skills_subdir: ".trae".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "trae-cn".into(),
            label: "Trae CN".into(),
            skills_subdir: ".trae-cn".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "hermes".into(),
            label: "Hermes".into(),
            skills_subdir: ".hermes".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "openclaw".into(),
            label: "OpenClaw".into(),
            skills_subdir: ".openclaw".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "workbuddy".into(),
            label: "WorkBuddy".into(),
            skills_subdir: ".workbuddy".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "qoder-cn".into(),
            label: "Qoder CN".into(),
            skills_subdir: ".qoder-cn".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "qoderworkcn".into(),
            label: "QoderWork CN".into(),
            skills_subdir: ".qoderworkcn".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "windsurf".into(),
            label: "Windsurf".into(),
            skills_subdir: ".windsurf".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "codebuddy".into(),
            label: "CodeBuddy".into(),
            skills_subdir: ".codebuddy".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "qwen-code".into(),
            label: "Qwen Code".into(),
            skills_subdir: ".qwen".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "qoder".into(),
            label: "Qoder".into(),
            skills_subdir: ".qoder".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "kilo".into(),
            label: "Kilo Code".into(),
            skills_subdir: ".kilocode".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "antigravity".into(),
            label: "Antigravity".into(),
            skills_subdir: ".gemini/antigravity".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "grok".into(),
            label: "Grok Build".into(),
            skills_subdir: ".grok".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "pi".into(),
            label: "Pi".into(),
            skills_subdir: ".pi/agent".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "kimi-code".into(),
            label: "Kimi Code".into(),
            skills_subdir: ".kimi-code".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "dsh".into(),
            label: "DeepSeek Harness".into(),
            skills_subdir: ".dsh".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
        AgentConfig {
            id: "zcode".into(),
            label: "ZCode".into(),
            skills_subdir: ".zcode".into(),
            skills_dir: None,
            has_usage_tracking: false,
        },
    ]
});

/// Visible-agent cap. Preference saves only guard growth past it
/// (`commands::settings::exceeds_visible_agent_cap`); registration checks it directly.
pub const MAX_VISIBLE_AGENTS: usize = 7;

pub fn default_visibility(agent_id: &str) -> bool {
    !matches!(
        agent_id,
        "trae"
            | "trae-cn"
            | "gemini"
            | "opencode"
            | "workbuddy"
            | "qoder-cn"
            | "qoderworkcn"
            | "windsurf"
            | "codebuddy"
            | "qwen-code"
            | "qoder"
            | "kilo"
            | "antigravity"
            | "grok"
            | "pi"
            | "kimi-code"
            | "dsh"
            | "zcode"
    )
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPathInfo {
    pub agent: String,
    pub label: String,
    pub path: String,
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suppressed_by: Option<String>,
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
        suppressed_by: None,
    });

    // Per-agent paths use one snapshot, including informational suppressed defaults.
    let snapshot = agents();
    for agent in snapshot.iter() {
        if let Some(dir) = agent_skills_dir(agent) {
            paths.push(AgentPathInfo {
                agent: agent.id.to_string(),
                label: agent.label.to_string(),
                path: dir.display().to_string(),
                exists: dir.exists(),
                suppressed_by: None,
            });
        }
    }

    paths.extend(suppressed_builtin_paths(&snapshot));
    paths
}

pub fn get_app_config_dir() -> PathBuf {
    home_dir()
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

pub fn get_external_imports_file() -> PathBuf {
    get_app_config_dir().join("imports.json")
}

pub fn get_agents_skills_dir() -> PathBuf {
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".agents")
        .join("skills")
}

pub fn get_agent_lock_file() -> PathBuf {
    get_agents_skills_dir()
        .parent()
        .map(|p| p.join(".skill-lock.json"))
        .unwrap_or_else(|| {
            home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".agents")
                .join(".skill-lock.json")
        })
}

pub fn agent_skills_dir(agent: &AgentConfig) -> Option<PathBuf> {
    if let Some(path) = &agent.skills_dir {
        return Some(path.clone());
    }
    Some(home_dir()?.join(&agent.skills_subdir).join("skills"))
}

pub fn get_agent_skills_dir(agent_id: &str) -> Option<PathBuf> {
    if agent_id == "ssot" {
        return Some(get_agents_skills_dir());
    }
    let snapshot = agents();
    agent_skills_dir(snapshot.iter().find(|a| a.id == agent_id)?)
}

// Replacing the snapshot happens only after durable registry changes. Readers
// clone an Arc, never the list or its strings on the per-skill lookup path.
static AGENT_SNAPSHOT: LazyLock<RwLock<Arc<Vec<AgentConfig>>>> =
    LazyLock::new(|| RwLock::new(Arc::new(AGENTS.clone())));

pub fn agents() -> Arc<Vec<AgentConfig>> {
    if let Some(snapshot) = OPERATION_AGENTS.with(|v| v.borrow().clone()) {
        return snapshot;
    }
    #[cfg(any(test, feature = "test-helpers"))]
    if let Some(snapshot) = TEST_SNAPSHOT.with(|v| v.borrow().clone()) {
        return snapshot;
    }
    AGENT_SNAPSHOT
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

pub fn refresh_agents() -> Result<(), crate::error::AppError> {
    let registry = crate::persistence::agents::AgentRegistry::load_from(
        &get_app_config_dir().join("agents.json"),
    )?;
    publish_agents(registry);
    Ok(())
}

pub fn publish_agents(registry: crate::persistence::agents::AgentRegistry) {
    let resolved = resolve_agents(registry);
    #[cfg(any(test, feature = "test-helpers"))]
    if TEST_HOME.with(|v| v.borrow().is_some()) {
        TEST_SNAPSHOT.with(|v| *v.borrow_mut() = Some(Arc::new(resolved)));
        return;
    }
    *AGENT_SNAPSHOT.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(resolved);
}

pub(crate) fn resolve_agents(
    registry: crate::persistence::agents::AgentRegistry,
) -> Vec<AgentConfig> {
    let custom: Vec<_> = registry
        .agents
        .into_iter()
        .map(|a| AgentConfig {
            id: a.id,
            label: a.label,
            skills_subdir: String::new(),
            skills_dir: Some(a.skills_dir),
            has_usage_tracking: false,
        })
        .collect();
    let mut resolved: Vec<_> = AGENTS
        .iter()
        .filter(|builtin| conflicting_custom(builtin, &custom).is_none())
        .cloned()
        .collect();
    resolved.extend(custom);
    for agent in &mut resolved {
        agent.has_usage_tracking = crate::services::skill_usage::supports_agent(&agent.id);
    }
    resolved
}

fn conflicting_custom<'a>(
    builtin: &AgentConfig,
    custom: &'a [AgentConfig],
) -> Option<&'a AgentConfig> {
    if !custom.iter().any(|a| a.id.starts_with("custom-")) {
        return None;
    }
    let root = agent_skills_dir(builtin)?;
    let root = resolve_missing_path(&root).ok()?;
    custom
        .iter()
        .filter(|a| a.id.starts_with("custom-"))
        .find(|a| {
            agent_skills_dir(a)
                .and_then(|path| resolve_missing_path(&path).ok())
                .is_some_and(|path| overlaps(&root, &path))
        })
}

fn suppressed_builtin_paths(snapshot: &[AgentConfig]) -> Vec<AgentPathInfo> {
    AGENTS
        .iter()
        .filter_map(|builtin| {
            if snapshot.iter().any(|a| a.id == builtin.id) {
                return None;
            }
            let custom = conflicting_custom(builtin, snapshot)?;
            let dir = agent_skills_dir(builtin)?;
            Some(AgentPathInfo {
                agent: builtin.id.clone(),
                label: builtin.label.clone(),
                path: dir.display().to_string(),
                exists: dir.exists(),
                suppressed_by: Some(custom.id.clone()),
            })
        })
        .collect()
}

pub(crate) fn resolve_missing_path(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return path.canonicalize().map_err(|e| e.to_string());
    }
    if std::fs::symlink_metadata(path).is_ok() {
        return Err("Directory is a broken link".into());
    }
    let parent = path.parent().ok_or("Invalid Skills directory")?;
    Ok(resolve_missing_path(parent)?.join(path.file_name().ok_or("Invalid Skills directory")?))
}

pub(crate) fn overlaps(a: &Path, b: &Path) -> bool {
    #[cfg(windows)]
    let (a, b) = (
        PathBuf::from(a.to_string_lossy().to_lowercase()),
        PathBuf::from(b.to_string_lossy().to_lowercase()),
    );
    #[cfg(windows)]
    let (a, b) = (a.as_path(), b.as_path());
    if a.starts_with(b) || b.starts_with(a) {
        return true;
    }
    // Existing ancestor identities also recognize case aliases when leaf roots are missing.
    let ancestors: std::collections::HashMap<_, _> = a
        .ancestors()
        .filter_map(|parent| {
            crate::services::skill::directory_identity(parent)
                .map(|key| (key, a.strip_prefix(parent).unwrap()))
        })
        .collect();
    b.ancestors().any(|parent| {
        crate::services::skill::directory_identity(parent)
            .and_then(|key| ancestors.get(&key))
            .is_some_and(|left| {
                let right = b.strip_prefix(parent).unwrap();
                left.starts_with(right) || right.starts_with(left)
            })
    })
}

pub fn home_dir() -> Option<PathBuf> {
    #[cfg(any(test, feature = "test-helpers"))]
    if let Some(home) = TEST_HOME.with(|v| v.borrow().clone()) {
        return Some(home);
    }
    dirs::home_dir()
}

#[cfg(any(test, feature = "test-helpers"))]
thread_local! {
    static TEST_HOME: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
    static TEST_SNAPSHOT: std::cell::RefCell<Option<Arc<Vec<AgentConfig>>>> = const { std::cell::RefCell::new(None) };
}

/// Isolate production-path filesystem tests without changing HOME or global
/// registry state belonging to other test threads.
#[cfg(any(test, feature = "test-helpers"))]
pub fn with_test_home<T>(home: &std::path::Path, run: impl FnOnce() -> T) -> T {
    struct Restore(Option<PathBuf>, Option<Arc<Vec<AgentConfig>>>);
    impl Drop for Restore {
        fn drop(&mut self) {
            TEST_HOME.with(|v| *v.borrow_mut() = self.0.take());
            TEST_SNAPSHOT.with(|v| *v.borrow_mut() = self.1.take());
        }
    }
    let _restore = Restore(
        TEST_HOME.with(|v| v.replace(Some(home.to_path_buf()))),
        TEST_SNAPSHOT.with(|v| v.replace(Some(Arc::new(AGENTS.clone())))),
    );
    run()
}

thread_local! {
    static OPERATION_AGENTS: std::cell::RefCell<Option<Arc<Vec<AgentConfig>>>> = const { std::cell::RefCell::new(None) };
}

/// Pin one immutable registry for a synchronous scan, including nested path
/// lookups. This scope never spans an await or holds a registry lock over I/O.
pub fn with_agent_snapshot<T>(snapshot: Arc<Vec<AgentConfig>>, run: impl FnOnce() -> T) -> T {
    struct Restore(Option<Arc<Vec<AgentConfig>>>);
    impl Drop for Restore {
        fn drop(&mut self) {
            OPERATION_AGENTS.with(|v| *v.borrow_mut() = self.0.take());
        }
    }
    let _restore = Restore(OPERATION_AGENTS.with(|v| v.replace(Some(snapshot))));
    run()
}

#[cfg(test)]
mod upgrade_tests {
    use super::*;
    use crate::persistence::agents::{AgentRegistry, CustomAgent};

    #[test]
    fn shipped_collision_preserves_custom_identity_and_coexisting_names() {
        let tmp = tempfile::tempdir().unwrap();
        with_test_home(tmp.path(), || {
            let mut registry: AgentRegistry = serde_json::from_str(include_str!(
                "../../fixtures/local-protocol/agents-v1-builtin-collision.json"
            ))
            .unwrap();
            for agent in &mut registry.agents {
                agent.skills_dir = tmp
                    .path()
                    .join(agent.skills_dir.strip_prefix("/fixture-home").unwrap());
            }
            let path = get_app_config_dir().join("agents.json");
            registry.save_to(&path).unwrap();
            let before = std::fs::read(&path).unwrap();
            refresh_agents().unwrap();
            let custom = &registry.agents[0];
            assert_eq!(
                get_agent_skills_dir(&custom.id),
                Some(custom.skills_dir.clone())
            );
            assert!(get_agent_skills_dir("codex").is_none());
            assert!(get_agent_skills_dir("gemini").is_some());
            assert_eq!(agents().iter().filter(|a| a.label == "Gemini").count(), 2);
            assert!(
                !agents()
                    .iter()
                    .find(|a| a.id == custom.id)
                    .unwrap()
                    .has_usage_tracking
            );
            let paths = get_all_agent_paths();
            assert_eq!(
                paths
                    .iter()
                    .find(|a| a.agent == "codex")
                    .unwrap()
                    .suppressed_by
                    .as_deref(),
                Some(custom.id.as_str())
            );
            assert_eq!(std::fs::read(&path).unwrap(), before);
            // Removing a registration re-enables the shipped target without aliasing its ID.
            publish_agents(AgentRegistry::default());
            assert!(get_agent_skills_dir("codex").is_some());
            assert!(get_agent_skills_dir(&custom.id).is_none());
        });
    }

    #[test]
    fn upgrade_detects_missing_nested_and_ancestor_roots() {
        for relative in [".codex", ".codex/skills", ".codex/skills/nested"] {
            let tmp = tempfile::tempdir().unwrap();
            with_test_home(tmp.path(), || {
                publish_agents(AgentRegistry {
                    version: 1,
                    agents: vec![CustomAgent {
                        id: "custom-11111111-1111-4111-a111-111111111111".into(),
                        label: "My Tool".into(),
                        skills_dir: tmp.path().join(relative),
                    }],
                });
                assert!(get_agent_skills_dir("codex").is_none());
                assert!(get_agent_skills_dir("claude-code").is_some());
            });
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn upgrade_detects_case_alias_with_missing_leaf_roots() {
        let tmp = tempfile::tempdir().unwrap();
        with_test_home(tmp.path(), || {
            std::fs::create_dir(tmp.path().join(".codex")).unwrap();
            let alias = tmp.path().join(".CODEX");
            if !alias.exists() {
                return;
            } // Case-sensitive test volumes have no such alias.
            publish_agents(AgentRegistry {
                version: 1,
                agents: vec![CustomAgent {
                    id: "custom-11111111-1111-4111-a111-111111111111".into(),
                    label: "Alias".into(),
                    skills_dir: alias.join("skills"),
                }],
            });
            assert!(get_agent_skills_dir("codex").is_none());
        });
    }

    #[cfg(unix)]
    #[test]
    fn upgrade_detects_symlinked_existing_ancestor() {
        let tmp = tempfile::tempdir().unwrap();
        with_test_home(tmp.path(), || {
            let root = tmp.path().join("original");
            std::fs::create_dir(&root).unwrap();
            std::os::unix::fs::symlink(&root, tmp.path().join(".codex")).unwrap();
            publish_agents(AgentRegistry {
                version: 1,
                agents: vec![CustomAgent {
                    id: "custom-11111111-1111-4111-a111-111111111111".into(),
                    label: "Alias".into(),
                    skills_dir: root.join("skills"),
                }],
            });
            assert!(get_agent_skills_dir("codex").is_none());
        });
    }
}
