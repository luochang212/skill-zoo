use crate::config;
use crate::config::{overlaps, resolve_missing_path};
use crate::persistence::agents::{AgentRegistry, CustomAgent};
use crate::persistence::{
    agent_transaction, ArchiveManifest, ExternalImportEntry, ExternalImports,
};
use crate::services::skill::{is_app_owned_link, is_symlink_or_junction, SkillService};
use crate::store::AppState;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::{Emitter, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPreview {
    path: String,
    exists: bool,
    retained_skills: usize,
    owned_links: usize,
    archived_references: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChangeResult {
    agent_id: String,
    hidden: bool,
    cleanup_failed: bool,
    refresh_failed: bool,
}

struct CreatedDirs(Vec<PathBuf>);
impl CreatedDirs {
    fn create(&mut self, path: &Path) -> Result<(), String> {
        let mut missing = Vec::new();
        let mut cursor = path;
        while !cursor.exists() {
            missing.push(cursor.to_path_buf());
            cursor = cursor.parent().ok_or("Invalid Skills directory")?;
        }
        for directory in missing.into_iter().rev() {
            match std::fs::create_dir(&directory) {
                Ok(()) => self.0.push(directory),
                Err(error)
                    if error.kind() == std::io::ErrorKind::AlreadyExists && directory.is_dir() => {}
                Err(error) => return Err(error.to_string()),
            }
        }
        Ok(())
    }
}
impl Drop for CreatedDirs {
    fn drop(&mut self) {
        for path in self.0.iter().rev() {
            let _ = std::fs::remove_dir(path);
        }
    }
}

fn expanded_path(input: &str) -> Result<PathBuf, String> {
    let path = if let Some(rest) = input.strip_prefix("~/") {
        config::home_dir()
            .ok_or("Home directory is unavailable")?
            .join(rest)
    } else {
        PathBuf::from(input)
    };
    if !path.is_absolute() {
        return Err("Skills directory must be an absolute path".into());
    }
    resolve_missing_path(&path)
}

fn validate(
    name: &str,
    path: &Path,
    id: Option<&str>,
    agents: &[config::AgentConfig],
    protected: &[PathBuf],
) -> Result<(), String> {
    if name.is_empty() || name.chars().count() > 64 {
        return Err("Agent name must contain 1–64 characters".into());
    }
    if path.join("SKILL.md").is_file() {
        return Err(
            "Choose the directory containing skill folders, not a single skill folder".into(),
        );
    }
    if path.exists() && !path.is_dir() {
        return Err("Skills directory is not a directory".into());
    }
    for agent in agents {
        if id == Some(agent.id.as_str()) {
            continue;
        }
        if agent.id.starts_with("custom-") && agent.label.to_lowercase() == name.to_lowercase() {
            return Err("An agent with this name already exists".into());
        }
        let root = match agent.skills_dir.clone() {
            Some(dir) => dir,
            None => config::home_dir()
                .ok_or("Home directory is unavailable")?
                .join(&agent.skills_subdir)
                .join("skills"),
        };
        if let Ok(root) = resolve_missing_path(&root) {
            if overlaps(path, &root) {
                return Err(format!("Skills directory overlaps {}", agent.label));
            }
        }
    }
    for root in protected {
        let root = resolve_missing_path(root)?;
        if overlaps(path, &root) {
            return Err("Skills directory overlaps Skill Zoo storage".into());
        }
    }
    if path.exists() {
        std::fs::read_dir(path).map_err(|_| "Skills directory cannot be read".to_string())?;
    }
    Ok(())
}

fn real_skills(root: &Path) -> Result<Vec<PathBuf>, String> {
    fn scan(path: &Path, skills: &mut Vec<PathBuf>) -> Result<(), String> {
        if is_symlink_or_junction(path) || !path.is_dir() {
            return Ok(());
        }
        if path.join("SKILL.md").is_file() {
            skills.push(path.to_path_buf());
            return Ok(());
        }
        // Unreadable directories are skipped, matching the scanner's behavior
        // (services::skill::collect_files_recursive), so a permissions problem
        // cannot block agent removal or path changes.
        let Ok(entries) = std::fs::read_dir(path) else {
            return Ok(());
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if config::SKIP_DIRS.contains(&name.as_str()) || SkillService::is_app_temp_dir(&name) {
                continue;
            }
            scan(&entry.path(), skills)?;
        }
        Ok(())
    }
    let mut skills = Vec::new();
    scan(root, &mut skills)?;
    Ok(skills)
}

fn preview_path(state: &AppState, path: &Path, id: Option<&str>) -> Result<AgentPreview, String> {
    let skills = real_skills(path)?;
    let imports = ExternalImports::load().map_err(|e| e.to_string())?;
    let mut known: Vec<PathBuf> = skills
        .iter()
        .cloned()
        .chain(
            imports
                .imports
                .values()
                .map(|i| PathBuf::from(&i.source_path)),
        )
        .collect();
    known.extend(
        state
            .skill_cache
            .read()
            .map_err(|e| e.to_string())?
            .skills()
            .iter()
            .filter_map(|s| s.home_path.as_ref().map(PathBuf::from)),
    );
    let mut owned_links = 0;
    if path.is_dir() {
        // Best-effort count, like the link cleanup this previews.
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if is_symlink_or_junction(&path)
                    && is_app_owned_link(&path, &config::get_agents_skills_dir(), &known)
                {
                    owned_links += 1;
                }
            }
        }
    }
    let archived_references = ArchiveManifest::load()
        .map_err(|e| e.to_string())?
        .skills
        .values()
        .filter(|s| {
            id.is_some_and(|id| s.home_agent.as_deref() == Some(id) || s.apps.contains_key(id))
        })
        .count();
    Ok(AgentPreview {
        path: path.to_string_lossy().into(),
        exists: path.is_dir(),
        retained_skills: skills.len(),
        owned_links,
        archived_references,
    })
}

#[tauri::command]
pub fn preview_custom_agent(
    state: State<'_, AppState>,
    name: String,
    skills_dir: String,
    agent_id: Option<String>,
) -> Result<AgentPreview, String> {
    let path = expanded_path(&skills_dir)?;
    validate(
        name.trim(),
        &path,
        agent_id.as_deref(),
        &config::agents(),
        &[
            config::get_agents_skills_dir(),
            config::get_app_config_dir(),
        ],
    )?;
    preview_path(&state, &path, agent_id.as_deref())
}

#[tauri::command]
pub fn preview_agent_removal(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<AgentPreview, String> {
    let path = config::get_agent_skills_dir(&agent_id).ok_or("Unknown agent")?;
    if !agent_id.starts_with("custom-") {
        return Err("Built-in agents cannot be removed".into());
    }
    preview_path(&state, &path, Some(&agent_id))
}

#[tauri::command]
pub async fn pick_agent_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let selected =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
            .await
            .map_err(|e| e.to_string())?;
    selected
        .map(|p| {
            p.into_path()
                .map(|p| p.to_string_lossy().into_owned())
                .map_err(|e| e.to_string())
        })
        .transpose()
}

#[tauri::command]
pub async fn save_custom_agent(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    agent_id: Option<String>,
    name: String,
    skills_dir: String,
    create_directory: bool,
) -> Result<AgentChangeResult, String> {
    change_agent(
        app,
        state,
        agent_id,
        Some((name, skills_dir, create_directory)),
    )
    .await
}

#[tauri::command]
pub async fn remove_custom_agent(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<AgentChangeResult, String> {
    change_agent(app, state, Some(agent_id), None).await
}

async fn change_agent(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    requested_id: Option<String>,
    input: Option<(String, String, bool)>,
) -> Result<AgentChangeResult, String> {
    let (mut result, needs_refresh, _lease) = commit_agent_change(&state, requested_id, input)?;
    let mut refresh_failed = false;
    if needs_refresh {
        if let Err(e) = SkillService::rebuild_cache(
            &state.skill_cache,
            &state.metadata,
            &state.cache_refresh_lock,
        )
        .await
        {
            eprintln!("Agent registered; cache refresh failed: {e}");
            refresh_failed = true;
        }
        if let Err(e) = crate::services::watcher::restart_skill_watcher(&app, &state) {
            eprintln!("Agent registered; watcher refresh failed: {e}");
            refresh_failed = true;
        }
    }
    let _ = app.emit(
        "skills-changed",
        serde_json::json!({ "agentsChanged": true }),
    );
    result.refresh_failed = refresh_failed;
    Ok(result)
}

fn commit_agent_change(
    state: &AppState,
    requested_id: Option<String>,
    input: Option<(String, String, bool)>,
) -> Result<(AgentChangeResult, bool, agent_transaction::AgentLease), String> {
    let dir = config::get_app_config_dir();
    let _lease = agent_transaction::AgentLease::acquire(&dir).map_err(|e| e.to_string())?;
    let mut registry =
        AgentRegistry::load_from(&dir.join("agents.json")).map_err(|e| e.to_string())?;
    let old = if let Some(id) = &requested_id {
        Some(
            registry
                .agents
                .iter()
                .find(|a| &a.id == id)
                .cloned()
                .ok_or("Unknown custom agent")?,
        )
    } else {
        None
    };
    let id = requested_id.unwrap_or_else(|| {
        let bits = rand::random::<u128>();
        let hex = format!("{bits:032x}");
        format!(
            "custom-{}-{}-4{}-a{}-{}",
            &hex[..8],
            &hex[8..12],
            &hex[13..16],
            &hex[17..20],
            &hex[20..]
        )
    });
    let mut settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
    let mut visible = SkillService::get_visible_agents(&settings);
    if input.is_none()
        && visible.get(&id).copied().unwrap_or(false)
        && visible.values().filter(|v| **v).count() <= 1
    {
        return Err("Show another agent before removing the last visible agent".into());
    }
    let mut created_dirs = CreatedDirs(Vec::new());
    let next = if let Some((name, raw_path, create)) = input {
        let name = name.trim().to_string();
        let path = expanded_path(&raw_path)?;
        validate(
            &name,
            &path,
            Some(&id),
            &config::agents(),
            &[config::get_agents_skills_dir(), dir.clone()],
        )?;
        if !path.exists() {
            if !create {
                return Err("Confirm creation of the missing Skills directory".into());
            }
            created_dirs.create(&path)?;
        }
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        validate(
            &name,
            &path,
            Some(&id),
            &config::agents(),
            &[config::get_agents_skills_dir(), dir.clone()],
        )?;
        Some(CustomAgent {
            id: id.clone(),
            label: name,
            skills_dir: path,
        })
    } else {
        None
    };
    let root_changed = old.as_ref().is_some_and(|old| {
        next.as_ref()
            .is_none_or(|next| old.skills_dir != next.skills_dir)
    });
    let mut imports = ExternalImports::load().map_err(|e| e.to_string())?;
    if imports.version != 1 {
        return Err("Upgrade Skill Zoo before changing agent ownership".into());
    }
    let mut known = state
        .skill_cache
        .read()
        .map_err(|e| e.to_string())?
        .skills()
        .iter()
        .filter_map(|s| s.home_path.as_ref().map(PathBuf::from))
        .collect::<Vec<_>>();
    if root_changed {
        let old = old.as_ref().unwrap();
        for root in real_skills(&old.skills_dir)? {
            let source = root.to_string_lossy().to_string();
            if imports.imports.values().any(|i| i.source_path == source) {
                continue;
            }
            let entry = SkillService::scan_skill_root(&root, &old.skills_dir, Some(&id))
                .map_err(|e| e.to_string())?;
            imports.imports.insert(
                entry.id.clone(),
                ExternalImportEntry {
                    id: entry.id,
                    source_path: source,
                    directory: entry.directory,
                    imported_at: entry.installed_at,
                    updated_at: entry.updated_at,
                },
            );
            known.push(root);
        }
    }
    if root_changed {
        let old = old.as_ref().unwrap();
        for archived in ArchiveManifest::load()
            .map_err(|e| e.to_string())?
            .skills
            .values()
            .filter(|s| s.home_agent.as_deref() == Some(&id))
        {
            let source = archived.home_path.clone().unwrap_or_else(|| {
                old.skills_dir
                    .join(&archived.directory)
                    .to_string_lossy()
                    .into_owned()
            });
            imports
                .imports
                .entry(archived.original_skill_id.clone())
                .or_insert_with(|| ExternalImportEntry {
                    id: archived.original_skill_id.clone(),
                    source_path: source,
                    directory: archived.directory.clone(),
                    imported_at: archived.installed_at,
                    updated_at: archived.updated_at,
                });
        }
    }
    if let Some(next) = &next {
        if let Some(existing) = registry.agents.iter_mut().find(|a| a.id == id) {
            *existing = next.clone();
        } else {
            registry.agents.push(next.clone());
        }
    } else {
        registry.agents.retain(|a| a.id != id);
    }
    if old.is_none() {
        visible.insert(
            id.clone(),
            visible.values().filter(|v| **v).count() < config::MAX_VISIBLE_AGENTS,
        );
    }
    if next.is_none() {
        visible.remove(&id);
    }
    // Reappearing shipped defaults must not unexpectedly exceed the visible cap.
    let effective = config::resolve_agents(registry.clone());
    let saved_visible: std::collections::HashMap<String, bool> = settings
        .get("visible_agents")
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    for agent in &effective {
        if !visible.contains_key(&agent.id) {
            let desired = saved_visible
                .get(&agent.id)
                .copied()
                .unwrap_or_else(|| config::default_visibility(&agent.id));
            visible.insert(
                agent.id.clone(),
                desired && visible.values().filter(|v| **v).count() < config::MAX_VISIBLE_AGENTS,
            );
        }
    }
    // Keep dormant built-in preferences; never count them as active targets.
    let mut persisted_visible = visible.clone();
    for builtin in config::AGENTS
        .iter()
        .filter(|a| !effective.iter().any(|e| e.id == a.id))
    {
        if let Some(value) = saved_visible.get(&builtin.id) {
            persisted_visible.insert(builtin.id.clone(), *value);
        }
    }
    settings.set(
        "visible_agents".into(),
        serde_json::to_string(&persisted_visible).map_err(|e| e.to_string())?,
    );
    let mut order: Vec<String> = settings
        .get("agent_order")
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    if next.is_none() {
        order.retain(|a| a != &id);
    }
    if next.is_some() && !order.contains(&id) {
        order.push(id.clone());
    }
    settings.set(
        "agent_order".into(),
        serde_json::to_string(&order).map_err(|e| e.to_string())?,
    );
    registry.validate().map_err(|e| e.to_string())?;
    let changes = BTreeMap::from([
        (
            "agents.json".into(),
            Some(serde_json::to_string_pretty(&registry).map_err(|e| e.to_string())?),
        ),
        (
            "imports.json".into(),
            Some(serde_json::to_string_pretty(&imports).map_err(|e| e.to_string())?),
        ),
        (
            "settings.json".into(),
            Some(serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?),
        ),
    ]);
    if let Err(e) = agent_transaction::commit(&dir, changes) {
        return Err(e.to_string());
    }
    created_dirs.0.clear();
    *state.settings.lock().map_err(|e| e.to_string())? = settings;
    config::publish_agents(registry);
    let cleanup_failed = if root_changed {
        match SkillService::stage_agent_symlink_removal_in_dirs(
            &[old.as_ref().unwrap().skills_dir.clone()],
            &known,
        ) {
            Ok(staged) => {
                staged.commit();
                false
            }
            Err(e) => {
                eprintln!("Agent link cleanup failed: {e}");
                true
            }
        }
    } else {
        false
    };
    Ok((
        AgentChangeResult {
            hidden: !visible.get(&id).copied().unwrap_or(false),
            agent_id: id,
            cleanup_failed,
            refresh_failed: false,
        },
        old.is_none() || root_changed,
        _lease,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> AppState {
        AppState::new(
            crate::persistence::SkillCache::empty(),
            crate::persistence::MetadataStore {
                entries: Default::default(),
            },
            crate::persistence::Settings {
                values: Default::default(),
            },
        )
    }

    #[test]
    fn upgrade_path_change_reactivates_builtin_without_changing_ownership_or_exceeding_cap() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let root = tmp.path().join(".codex/skills");
            let skill = root.join("demo");
            std::fs::create_dir_all(&skill).unwrap();
            std::fs::write(skill.join("SKILL.md"), "# Original").unwrap();
            let id = "custom-11111111-1111-4111-a111-111111111111";
            let registry = AgentRegistry {
                version: 1,
                agents: vec![CustomAgent {
                    id: id.into(),
                    label: "Codex".into(),
                    skills_dir: root.clone(),
                }],
            };
            registry
                .save_to(&config::get_app_config_dir().join("agents.json"))
                .unwrap();
            config::refresh_agents().unwrap();
            let state = state();
            let entry = SkillService::scan_skill_root(&skill, &root, Some(id)).unwrap();
            state.skill_cache.write().unwrap().upsert(entry.clone());
            state.metadata.write().unwrap().set_starred(&entry.id, true);
            let mut visible: std::collections::HashMap<String, bool> = config::agents()
                .iter()
                .map(|a| (a.id.clone(), false))
                .collect();
            visible.insert(id.into(), true);
            for a in config::agents().iter().filter(|a| a.id != id).take(6) {
                visible.insert(a.id.clone(), true);
            }
            // Preserve a dormant built-in preference, but cap takes priority on reactivation.
            visible.insert("codex".into(), true);
            state.settings.lock().unwrap().set(
                "visible_agents".into(),
                serde_json::to_string(&visible).unwrap(),
            );
            let new_root = tmp.path().join("my-tool/skills");
            let (changed, _, lease) = commit_agent_change(
                &state,
                Some(id.into()),
                Some(("Codex".into(), new_root.to_string_lossy().into(), true)),
            )
            .unwrap();
            drop(lease);
            assert_eq!(changed.agent_id, id);
            assert!(config::get_agent_skills_dir("codex").is_some());
            let visible = SkillService::get_visible_agents(&state.settings.lock().unwrap());
            assert_eq!(visible.values().filter(|v| **v).count(), 7);
            assert!(!visible["codex"]);
            let imports = ExternalImports::load().unwrap();
            let retained =
                SkillService::scan_external_import(imports.imports.get(&entry.id).unwrap())
                    .unwrap();
            assert_eq!(retained.id, entry.id);
            assert_eq!(retained.origin, "external");
            assert!(retained.apps["codex"]);
            let incremental = SkillService::scan_skill_roots_batch(&[(
                skill.clone(),
                root,
                Some("codex".into()),
            )])
            .unwrap();
            assert_eq!(incremental.len(), 1);
            assert_eq!(incremental[0].id, entry.id);
            assert_eq!(incremental[0].origin, "external");
            assert!(state.metadata.read().unwrap().get(&entry.id).starred);
            assert_eq!(
                std::fs::read_to_string(skill.join("SKILL.md")).unwrap(),
                "# Original"
            );
        });
    }

    #[test]
    fn rename_and_removal_preserve_identity_files_metadata_and_other_links() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let state = state();
            let root = tmp.path().join("tool/skills");
            let (added, _, lease) = commit_agent_change(
                &state,
                None,
                Some(("Tool".into(), root.to_string_lossy().into(), true)),
            )
            .unwrap();
            drop(lease);
            let root = root.canonicalize().unwrap();
            let skill = root.join(".system/demo");
            std::fs::create_dir_all(&skill).unwrap();
            std::fs::write(skill.join("SKILL.md"), "# Demo").unwrap();
            let entry =
                SkillService::scan_skill_root(&skill, &root, Some(&added.agent_id)).unwrap();
            state.metadata.write().unwrap().set_starred(&entry.id, true);
            state.skill_cache.write().unwrap().upsert(entry.clone());
            let other = config::get_agent_skills_dir("codex").unwrap();
            std::fs::create_dir_all(&other).unwrap();
            SkillService::toggle_symlink(&entry.directory, &skill.to_string_lossy(), "codex", true)
                .unwrap();
            let original_order = state.settings.lock().unwrap().get("agent_order").cloned();
            let (renamed, refresh, lease) = commit_agent_change(
                &state,
                Some(added.agent_id.clone()),
                Some(("Renamed Tool".into(), root.to_string_lossy().into(), false)),
            )
            .unwrap();
            assert_eq!(renamed.agent_id, added.agent_id);
            assert!(!refresh);
            assert_eq!(
                state.settings.lock().unwrap().get("agent_order").cloned(),
                original_order
            );
            drop(lease);
            let (_, _, lease) =
                commit_agent_change(&state, Some(added.agent_id.clone()), None).unwrap();
            drop(lease);
            let imports = ExternalImports::load().unwrap();
            let retained = imports.imports.get(&entry.id).unwrap();
            let scanned = SkillService::scan_external_import(retained).unwrap();
            assert_eq!(scanned.id, entry.id);
            assert_eq!(scanned.origin, "external");
            assert!(state.metadata.read().unwrap().get(&entry.id).starred);
            assert_eq!(
                std::fs::read_to_string(skill.join("SKILL.md")).unwrap(),
                "# Demo"
            );
            assert_eq!(std::fs::canonicalize(other.join("demo")).unwrap(), skill);
            assert!(config::get_agent_skills_dir(&added.agent_id).is_none());
        });
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_subdirectory_skips_instead_of_blocking_removal() {
        use std::os::unix::fs::PermissionsExt;
        let restore = |locked: &std::path::Path| {
            std::fs::set_permissions(locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        };
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("tool/skills");
        let readable = root.join("demo");
        std::fs::create_dir_all(&readable).unwrap();
        std::fs::write(readable.join("SKILL.md"), "# Demo").unwrap();
        let locked = root.join("locked");
        std::fs::create_dir_all(&locked).unwrap();
        std::fs::write(locked.join("SKILL.md"), "# Locked").unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
        if std::fs::read_dir(&locked).is_ok() {
            restore(&locked); // Privileged runners can read mode-000 directories.
            return;
        }
        let skills = real_skills(&root).unwrap();
        restore(&locked);
        assert_eq!(skills, vec![readable]);
    }

    #[test]
    fn registration_around_an_existing_import_keeps_external_ownership() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let state = state();
            let root = tmp.path().join("tool/skills");
            let skill = root.join("demo");
            std::fs::create_dir_all(&skill).unwrap();
            std::fs::write(skill.join("SKILL.md"), "# Demo").unwrap();
            let mut imports = ExternalImports::default();
            imports.imports.insert(
                "external:demo".into(),
                ExternalImportEntry {
                    id: "external:demo".into(),
                    source_path: skill.canonicalize().unwrap().to_string_lossy().into(),
                    directory: "demo".into(),
                    imported_at: 1,
                    updated_at: 1,
                },
            );
            imports.save().unwrap();
            let (added, _, lease) = commit_agent_change(
                &state,
                None,
                Some(("Tool".into(), root.to_string_lossy().into(), false)),
            )
            .unwrap();
            drop(lease);
            let entry =
                SkillService::scan_external_import(&imports.imports["external:demo"]).unwrap();
            assert_eq!(entry.origin, "external");
            assert!(entry.apps[&added.agent_id]);
            assert!(skill.join("SKILL.md").is_file());
        });
    }

    #[test]
    fn archived_local_skill_restores_to_original_path_after_agent_removal() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let state = state();
            let root = tmp.path().join(".codex/skills");
            std::fs::create_dir_all(&root).unwrap();
            let id = "custom-11111111-1111-4111-a111-111111111111";
            AgentRegistry {
                version: 1,
                agents: vec![CustomAgent {
                    id: id.into(),
                    label: "Codex".into(),
                    skills_dir: root.clone(),
                }],
            }
            .save_to(&config::get_app_config_dir().join("agents.json"))
            .unwrap();
            config::refresh_agents().unwrap();
            let root = root.canonicalize().unwrap();
            let skill = root.join("demo");
            std::fs::create_dir(&skill).unwrap();
            std::fs::write(skill.join("SKILL.md"), "# Original").unwrap();
            let entry = SkillService::scan_skill_root(&skill, &root, Some(id)).unwrap();
            state.metadata.write().unwrap().set_starred(&entry.id, true);
            state.skill_cache.write().unwrap().upsert(entry.clone());
            crate::commands::skill::archive_skill_inner(&state, entry.id.clone()).unwrap();
            assert!(!skill.exists());
            let archive_id = ArchiveManifest::load()
                .unwrap()
                .skills
                .keys()
                .next()
                .unwrap()
                .clone();
            let (_, _, lease) = commit_agent_change(&state, Some(id.into()), None).unwrap();
            drop(lease);
            assert!(config::get_agent_skills_dir("codex").is_some());
            assert!(ExternalImports::load()
                .unwrap()
                .imports
                .contains_key(&entry.id));
            let restored =
                crate::commands::skill::restore_archived_skill_inner(&state, archive_id).unwrap();
            assert_eq!(restored, entry.id);
            assert_eq!(
                std::fs::read_to_string(skill.join("SKILL.md")).unwrap(),
                "# Original"
            );
            assert!(state.metadata.read().unwrap().get(&entry.id).starred);
            assert_eq!(
                state
                    .skill_cache
                    .read()
                    .unwrap()
                    .find_by_id(&entry.id)
                    .unwrap()
                    .origin,
                "external"
            );
        });
    }

    #[test]
    fn removing_last_visible_agent_is_rejected_and_adding_at_cap_is_hidden() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let state = state();
            let mut visible: std::collections::HashMap<String, bool> = config::agents()
                .iter()
                .map(|a| (a.id.clone(), false))
                .collect();
            for a in config::agents().iter().take(7) {
                visible.insert(a.id.clone(), true);
            }
            state.settings.lock().unwrap().set(
                "visible_agents".into(),
                serde_json::to_string(&visible).unwrap(),
            );
            let (added, _, lease) = commit_agent_change(
                &state,
                None,
                Some((
                    "Tool".into(),
                    tmp.path().join("tool/skills").to_string_lossy().into(),
                    true,
                )),
            )
            .unwrap();
            assert!(added.hidden);
            drop(lease);
            for value in visible.values_mut() {
                *value = false;
            }
            visible.insert(added.agent_id.clone(), true);
            state.settings.lock().unwrap().set(
                "visible_agents".into(),
                serde_json::to_string(&visible).unwrap(),
            );
            assert!(commit_agent_change(&state, Some(added.agent_id.clone()), None).is_err());
            assert!(config::get_agent_skills_dir(&added.agent_id).is_some());
        });
    }

    #[test]
    fn path_changes_keep_old_skills_and_stop_using_the_old_root_as_agent_home() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let state = state();
            let old = tmp.path().join("old/skills");
            let (added, _, lease) = commit_agent_change(
                &state,
                None,
                Some(("Tool".into(), old.to_string_lossy().into(), true)),
            )
            .unwrap();
            drop(lease);
            let skill = old.join("demo");
            std::fs::create_dir(&skill).unwrap();
            std::fs::write(skill.join("SKILL.md"), "# Keep me").unwrap();
            let new = tmp.path().join("new/skills");
            let (changed, refresh, lease) = commit_agent_change(
                &state,
                Some(added.agent_id.clone()),
                Some(("Tool".into(), new.to_string_lossy().into(), true)),
            )
            .unwrap();
            drop(lease);
            assert_eq!(changed.agent_id, added.agent_id);
            assert!(refresh);
            assert_eq!(
                config::get_agent_skills_dir(&added.agent_id).unwrap(),
                new.canonicalize().unwrap()
            );
            assert_eq!(
                std::fs::read_to_string(skill.join("SKILL.md")).unwrap(),
                "# Keep me"
            );
            assert!(!new.join("demo").exists());
            let imports = ExternalImports::load().unwrap();
            let retained = imports
                .imports
                .values()
                .find(|i| PathBuf::from(&i.source_path) == skill.canonicalize().unwrap())
                .unwrap();
            assert_eq!(
                SkillService::scan_external_import(retained).unwrap().origin,
                "external"
            );
        });
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_failure_does_not_roll_back_removal_or_touch_foreign_links() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let state = state();
            let root = tmp.path().join("tool/skills");
            let (added, _, lease) = commit_agent_change(
                &state,
                None,
                Some(("Tool".into(), root.to_string_lossy().into(), true)),
            )
            .unwrap();
            drop(lease);
            let target = config::get_agents_skills_dir().join("shared");
            std::fs::create_dir_all(&target).unwrap();
            let foreign = tmp.path().join("foreign");
            std::fs::create_dir(&foreign).unwrap();
            std::os::unix::fs::symlink(&target, root.join("shared")).unwrap();
            std::os::unix::fs::symlink(&foreign, root.join("foreign")).unwrap();
            let original = std::fs::metadata(&root).unwrap().permissions();
            std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o555)).unwrap();
            if std::fs::write(root.join("permission-probe"), "probe").is_ok() {
                std::fs::set_permissions(&root, original).unwrap();
                return; // Privileged test runners cannot exercise this failure.
            }
            let change = commit_agent_change(&state, Some(added.agent_id.clone()), None);
            std::fs::set_permissions(&root, original).unwrap();
            let (removed, _, lease) = change.unwrap();
            drop(lease);
            assert!(removed.cleanup_failed);
            assert!(config::get_agent_skills_dir(&added.agent_id).is_none());
            assert_eq!(
                root.join("foreign").canonicalize().unwrap(),
                foreign.canonicalize().unwrap()
            );
            assert!(target.exists());
        });
    }

    #[test]
    #[ignore = "filesystem lifecycle latency evidence; run explicitly"]
    fn custom_agent_lifecycle_performance() {
        use std::time::Instant;
        fn samples(mut operation: impl FnMut()) -> (f64, f64) {
            operation();
            let mut times = Vec::new();
            for _ in 0..7 {
                let start = Instant::now();
                operation();
                times.push(start.elapsed().as_secs_f64() * 1000.0);
            }
            times.sort_by(f64::total_cmp);
            (times[3], times[6])
        }
        for skills in [100, 1000] {
            for count in [5, 20] {
                let tmp = tempfile::tempdir().unwrap();
                config::with_test_home(tmp.path(), || {
                    let state = state();
                    let mut registry = AgentRegistry::default();
                    for j in 0..count {
                        let root = tmp.path().join(format!("tool-{j}/skills"));
                        std::fs::create_dir_all(&root).unwrap();
                        registry.agents.push(CustomAgent {
                            id: format!("custom-00000000-0000-4000-a000-{j:012}"),
                            label: format!("Tool {j}"),
                            skills_dir: root.canonicalize().unwrap(),
                        });
                    }
                    registry
                        .save_to(&config::get_app_config_dir().join("agents.json"))
                        .unwrap();
                    config::refresh_agents().unwrap();
                    let agent = registry.agents[0].clone();
                    for i in 0..skills {
                        let root = agent.skills_dir.join(format!("demo-{i}"));
                        std::fs::create_dir(&root).unwrap();
                        std::fs::write(root.join("SKILL.md"), "# Performance fixture").unwrap();
                    }
                    let mut i = 0;
                    let rename = samples(|| {
                        i += 1;
                        std::hint::black_box(
                            commit_agent_change(
                                &state,
                                Some(agent.id.clone()),
                                Some((
                                    format!("Renamed {i}"),
                                    agent.skills_dir.to_string_lossy().into(),
                                    false,
                                )),
                            )
                            .unwrap(),
                        );
                    });
                    let other = tmp.path().join("replacement/skills");
                    std::fs::create_dir_all(&other).unwrap();
                    let mut old_root = true;
                    let change_path = samples(|| {
                        let next = if old_root { &other } else { &agent.skills_dir };
                        std::hint::black_box(
                            commit_agent_change(
                                &state,
                                Some(agent.id.clone()),
                                Some(("Moving tool".into(), next.to_string_lossy().into(), false)),
                            )
                            .unwrap(),
                        );
                        old_root = !old_root;
                    });
                    println!("LIFECYCLE skills={skills} customs={count} rename={rename:?} path_change={change_path:?}");
                });
            }
        }
    }

    #[test]
    fn path_aliases_and_protected_roots_are_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let canonical_root = tmp.path().canonicalize().unwrap();
        let protected = canonical_root.join("store");
        std::fs::create_dir(&protected).unwrap();
        assert!(validate("Tool", &protected, None, &[], &[protected.clone()]).is_err());
        assert!(validate("Tool", &canonical_root, None, &[], &[protected.clone()]).is_err());
        assert!(validate("Tool", &protected.join("nested"), None, &[], &[protected]).is_err());
        let case_alias = canonical_root.join("STORE");
        if case_alias.is_dir() {
            assert!(validate(
                "Tool",
                &case_alias,
                None,
                &[],
                &[canonical_root.join("store")]
            )
            .is_err());
        }
        let path = canonical_root.join("new/skills");
        assert_eq!(resolve_missing_path(&path).unwrap(), path);
    }

    #[test]
    fn real_skill_scan_keeps_dot_namespaces_and_skips_links() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join(".system/demo");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("SKILL.md"), "# Demo").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&root, tmp.path().join("alias")).unwrap();
        assert_eq!(real_skills(tmp.path()).unwrap(), vec![root]);
    }
}
