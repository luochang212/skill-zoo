use crate::config;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub install_path: String,
    pub supported_agents: Vec<String>,
    pub components: Vec<PluginComponent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginComponent {
    #[serde(rename = "type")]
    pub component_type: String,
    pub count: u32,
    pub items: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct PluginManifest {
    name: Option<String>,
    version: Option<String>,
    description: Option<String>,
    author: Option<ManifestAuthor>,
}

#[derive(Debug, Deserialize)]
struct ManifestAuthor {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct McpJson {
    #[serde(rename = "mcpServers")]
    mcp_servers: Option<serde_json::Map<String, serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
struct HooksJson {
    hooks: Option<serde_json::Map<String, serde_json::Value>>,
}

const MANIFEST_PATHS: &[&str] = &[
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
    "gemini-extension.json",
];

fn find_plugin_dirs(root: &Path) -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();
    if !root.exists() {
        return dirs;
    }
    walk_for_plugins(root, &mut dirs);
    dirs
}

fn walk_for_plugins(dir: &Path, results: &mut Vec<std::path::PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if name.starts_with('.') {
            continue;
        }

        if has_any_manifest(&path) {
            results.push(path);
        } else {
            walk_for_plugins(&path, results);
        }
    }
}

fn has_any_manifest(dir: &Path) -> bool {
    MANIFEST_PATHS.iter().any(|m| dir.join(m).exists())
}

fn parse_first_manifest(dir: &Path) -> Option<PluginManifest> {
    for manifest_path in MANIFEST_PATHS {
        let full = dir.join(manifest_path);
        if full.exists() {
            if let Ok(content) = std::fs::read_to_string(&full) {
                if let Ok(m) = serde_json::from_str::<PluginManifest>(&content) {
                    return Some(m);
                }
            }
        }
    }
    None
}

fn scan_components(dir: &Path) -> Vec<PluginComponent> {
    let mut components = Vec::new();

    // Skills: subdirs of skills/ containing SKILL.md
    let skills_dir = dir.join("skills");
    if skills_dir.exists() {
        let mut items = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&skills_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() && p.join("SKILL.md").exists() {
                    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                        items.push(name.to_string());
                    }
                }
            }
        }
        if !items.is_empty() {
            items.sort();
            components.push(PluginComponent {
                component_type: "skills".to_string(),
                count: items.len() as u32,
                items,
            });
        }
    }

    // Commands: .md / .toml files in commands/
    let commands_dir = dir.join("commands");
    if commands_dir.exists() {
        let mut items = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&commands_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                        if ext == "md" || ext == "toml" {
                            if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                                items.push(stem.to_string());
                            }
                        }
                    }
                }
            }
        }
        if !items.is_empty() {
            items.sort();
            components.push(PluginComponent {
                component_type: "commands".to_string(),
                count: items.len() as u32,
                items,
            });
        }
    }

    // Agents: .md files in agents/
    let agents_dir = dir.join("agents");
    if agents_dir.exists() {
        let mut items = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&agents_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() && p.extension().map_or(false, |e| e == "md") {
                    if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                        items.push(stem.to_string());
                    }
                }
            }
        }
        if !items.is_empty() {
            items.sort();
            components.push(PluginComponent {
                component_type: "agents".to_string(),
                count: items.len() as u32,
                items,
            });
        }
    }

    // Hooks: hooks.json or hooks/hooks.json
    for hook_path in &[dir.join("hooks.json"), dir.join("hooks").join("hooks.json")] {
        if hook_path.exists() {
            if let Ok(content) = std::fs::read_to_string(hook_path) {
                if let Ok(hooks) = serde_json::from_str::<HooksJson>(&content) {
                    if let Some(hook_map) = hooks.hooks {
                        let mut items: Vec<String> = hook_map.keys().cloned().collect();
                        if !items.is_empty() {
                            items.sort();
                            components.push(PluginComponent {
                                component_type: "hooks".to_string(),
                                count: items.len() as u32,
                                items,
                            });
                        }
                    }
                }
            }
            break;
        }
    }

    // MCP servers: .mcp.json or mcp.json
    for mcp_path in &[dir.join(".mcp.json"), dir.join("mcp.json")] {
        if mcp_path.exists() {
            if let Ok(content) = std::fs::read_to_string(mcp_path) {
                if let Ok(mcp) = serde_json::from_str::<McpJson>(&content) {
                    if let Some(servers) = mcp.mcp_servers {
                        let mut items: Vec<String> = servers.keys().cloned().collect();
                        if !items.is_empty() {
                            items.sort();
                            components.push(PluginComponent {
                                component_type: "mcp".to_string(),
                                count: items.len() as u32,
                                items,
                            });
                        }
                    }
                }
            }
            break;
        }
    }

    // Rules: .md / .mdc files in rules/ (Cursor)
    let rules_dir = dir.join("rules");
    if rules_dir.exists() {
        let mut items = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&rules_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                        if ext == "md" || ext == "mdc" {
                            if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                                items.push(stem.to_string());
                            }
                        }
                    }
                }
            }
        }
        if !items.is_empty() {
            items.sort();
            components.push(PluginComponent {
                component_type: "rules".to_string(),
                count: items.len() as u32,
                items,
            });
        }
    }

    // LSP servers
    let lsp_path = dir.join("lsp-servers.json");
    if lsp_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&lsp_path) {
            if let Ok(lsp) = serde_json::from_str::<McpJson>(&content) {
                if let Some(servers) = lsp.mcp_servers {
                    let items: Vec<String> = servers.keys().cloned().collect();
                    if !items.is_empty() {
                        components.push(PluginComponent {
                            component_type: "lsp".to_string(),
                            count: items.len() as u32,
                            items,
                        });
                    }
                }
            }
        }
    }

    components
}

fn scan_agent_plugins(agent_id: &str, plugins_dir: &Path) -> Vec<PluginInfo> {
    let plugin_dirs = find_plugin_dirs(plugins_dir);
    let mut plugins = Vec::new();

    for dir in plugin_dirs {
        let manifest = parse_first_manifest(&dir);
        let components = scan_components(&dir);

        let name = manifest
            .as_ref()
            .and_then(|m| m.name.clone())
            .unwrap_or_else(|| {
                dir.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default()
            });

        let version = manifest.as_ref().and_then(|m| m.version.clone());
        let description = manifest.as_ref().and_then(|m| m.description.clone());
        let author = manifest
            .as_ref()
            .and_then(|m| m.author.as_ref())
            .and_then(|a| a.name.clone());

        plugins.push(PluginInfo {
            name,
            version,
            description,
            author,
            install_path: dir.display().to_string(),
            supported_agents: vec![agent_id.to_string()],
            components,
        });
    }

    plugins
}

pub fn scan_all_plugins(visible_agents: &[String]) -> Vec<PluginInfo> {
    let mut all = Vec::new();

    for agent_id in visible_agents {
        if let Some(plugins_dir) = config::get_agent_plugins_dir(agent_id) {
            let mut agent_plugins = scan_agent_plugins(agent_id, &plugins_dir);
            all.append(&mut agent_plugins);
        }
    }

    all
}
