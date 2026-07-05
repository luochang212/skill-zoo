use crate::config;
use crate::services::skill::SkillService;
use crate::store::AppState;
use notify::event::ModifyKind;
use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri::Manager;

const DEBOUNCE_MS: u64 = 1500;

#[derive(Debug, Clone, PartialEq, Eq)]
enum WatchRootKind {
    Ssot,
    Agent(String),
    Archive,
    External,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WatchRoot {
    path: PathBuf,
    kind: WatchRootKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SkillRoot {
    skill_root: PathBuf,
    scan_root: PathBuf,
    agent_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RefreshPlan {
    Noop,
    NotifyOnly,
    Incremental(Vec<SkillRoot>),
    FullRebuild,
}

fn collect_watch_roots() -> Vec<WatchRoot> {
    let mut roots = Vec::new();
    let agents_dir = config::get_agents_skills_dir();
    if agents_dir.exists() {
        roots.push(WatchRoot {
            path: agents_dir,
            kind: WatchRootKind::Ssot,
        });
    }
    let archive_dir = config::get_archive_dir();
    if archive_dir.exists() {
        roots.push(WatchRoot {
            path: archive_dir,
            kind: WatchRootKind::Archive,
        });
    }
    for agent in config::AGENTS {
        if let Some(agent_dir) = config::get_agent_skills_dir(agent.id) {
            if agent_dir.exists() {
                roots.push(WatchRoot {
                    path: agent_dir,
                    kind: WatchRootKind::Agent(agent.id.to_string()),
                });
            }
        }
    }
    roots
}

fn collect_watch_dirs() -> Vec<PathBuf> {
    collect_watch_roots()
        .into_iter()
        .map(|root| root.path)
        .collect()
}

fn collect_external_watch_roots() -> Vec<WatchRoot> {
    let Ok(imports) = crate::persistence::ExternalImports::load() else {
        return Vec::new();
    };
    imports
        .imports
        .values()
        .filter_map(|import| {
            let path = PathBuf::from(&import.source_path);
            path.exists().then_some(WatchRoot {
                path,
                kind: WatchRootKind::External,
            })
        })
        .collect()
}

pub fn start_skill_watcher(
    app_handle: tauri::AppHandle,
) -> Result<
    (
        notify::RecommendedWatcher,
        tauri::async_runtime::JoinHandle<()>,
    ),
    Box<dyn std::error::Error>,
> {
    let mut watch_dirs = collect_watch_dirs();
    let external_roots = collect_external_watch_roots();
    for root in &external_roots {
        watch_dirs.push(root.path.clone());
    }
    if watch_dirs.is_empty() {
        return Err("No skill directories exist to watch".into());
    }

    let (tx, rx) = tokio::sync::mpsc::channel::<Event>(64);

    let mut watcher = notify::RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                match event.kind {
                    EventKind::Access(_) | EventKind::Other => return,
                    _ => {}
                }
                let _ = tx.blocking_send(event);
            }
        },
        notify::Config::default(),
    )?;

    for dir in &watch_dirs {
        watcher.watch(dir, RecursiveMode::Recursive)?;
    }

    let join_handle = tauri::async_runtime::spawn(debounced_rebuild_loop(rx, app_handle));

    Ok((watcher, join_handle))
}

async fn debounced_rebuild_loop(
    mut rx: tokio::sync::mpsc::Receiver<Event>,
    app_handle: tauri::AppHandle,
) {
    loop {
        // Wait for the first event
        let Some(first_event) = rx.recv().await else {
            break;
        };
        let mut events = vec![first_event];

        // Debounce: reset timer on each subsequent event
        let timer = tokio::time::sleep(Duration::from_millis(DEBOUNCE_MS));
        tokio::pin!(timer);
        loop {
            tokio::select! {
                maybe_event = rx.recv() => {
                    match maybe_event {
                        Some(event) => {
                            events.push(event);
                            timer.as_mut().reset(
                                tokio::time::Instant::now() + Duration::from_millis(DEBOUNCE_MS),
                            );
                        }
                        None => {
                            return;
                        }
                    }
                }
                _ = &mut timer => {
                    break;
                }
            }
        }

        trigger_refresh(&app_handle, events).await;
    }
}

fn classify_events(events: &[Event], roots: &[WatchRoot]) -> RefreshPlan {
    let mut notify_only = false;
    let mut skill_roots: Vec<SkillRoot> = Vec::new();

    for event in events {
        if event.need_rescan() {
            return RefreshPlan::FullRebuild;
        }

        match event.kind {
            EventKind::Access(_) | EventKind::Other => continue,
            EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_)) | EventKind::Any => {
                return RefreshPlan::FullRebuild
            }
            _ => {}
        }

        if event.paths.is_empty() {
            continue;
        }

        for path in &event.paths {
            let Some(root) = root_for_path(path, roots) else {
                continue;
            };

            if path_has_ignored_component(path, &root.path) {
                continue;
            }

            if path == &root.path {
                match root.kind {
                    WatchRootKind::Archive => {
                        notify_only = true;
                        continue;
                    }
                    _ => return RefreshPlan::FullRebuild,
                }
            }

            if matches!(root.kind, WatchRootKind::Archive) {
                notify_only = true;
                continue;
            }

            if crate::services::skill::is_symlink_or_junction(path) {
                notify_only = true;
                continue;
            }

            if matches!(root.kind, WatchRootKind::External) {
                return RefreshPlan::FullRebuild;
            }

            if let Some(skill_root) = nearest_skill_root(path, &root.path) {
                let item = SkillRoot {
                    skill_root,
                    scan_root: root.path.clone(),
                    agent_id: match &root.kind {
                        WatchRootKind::Ssot | WatchRootKind::External => None,
                        WatchRootKind::Agent(agent) => Some(agent.clone()),
                        WatchRootKind::Archive => None,
                    },
                };
                if !skill_roots.contains(&item) {
                    skill_roots.push(item);
                }
            }
        }
    }

    if skill_roots.is_empty() {
        if notify_only {
            RefreshPlan::NotifyOnly
        } else {
            RefreshPlan::Noop
        }
    } else {
        RefreshPlan::Incremental(skill_roots)
    }
}

fn root_for_path<'a>(path: &Path, roots: &'a [WatchRoot]) -> Option<&'a WatchRoot> {
    roots
        .iter()
        .filter(|root| path == root.path.as_path() || path.starts_with(&root.path))
        .max_by_key(|root| root.path.components().count())
}

fn path_has_ignored_component(path: &Path, root: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        name.ends_with(".tmp") || config::SKIP_DIRS.contains(&name.as_ref())
    })
}

fn nearest_skill_root(path: &Path, scan_root: &Path) -> Option<PathBuf> {
    let mut current = if path.is_dir() { path } else { path.parent()? };

    loop {
        if !current.starts_with(scan_root) {
            return None;
        }
        if current.join("SKILL.md").exists() {
            return Some(current.to_path_buf());
        }
        if current == scan_root {
            return None;
        }
        current = current.parent()?;
    }
}

async fn trigger_refresh(app_handle: &tauri::AppHandle, events: Vec<Event>) {
    let mut roots = collect_watch_roots();
    roots.extend(collect_external_watch_roots());
    let plan = classify_events(&events, &roots);
    let started = Instant::now();

    match plan {
        RefreshPlan::Noop => {
            eprintln!(
                "Watcher refresh noop: {} event(s), {:?}",
                events.len(),
                started.elapsed()
            );
        }
        RefreshPlan::NotifyOnly => {
            let _ = app_handle.emit("skills-changed", ());
            eprintln!(
                "Watcher refresh notify-only: {} event(s), {:?}",
                events.len(),
                started.elapsed()
            );
        }
        RefreshPlan::FullRebuild => {
            trigger_rebuild(app_handle, events.len(), started).await;
        }
        RefreshPlan::Incremental(skill_roots) => {
            if trigger_incremental_refresh(app_handle, &skill_roots).await {
                let _ = app_handle.emit("skills-changed", ());
                eprintln!(
                    "Watcher refresh incremental: {} event(s), {} skill(s), {:?}",
                    events.len(),
                    skill_roots.len(),
                    started.elapsed()
                );
            } else {
                trigger_rebuild(app_handle, events.len(), started).await;
            }
        }
    }
}

async fn trigger_incremental_refresh(
    app_handle: &tauri::AppHandle,
    skill_roots: &[SkillRoot],
) -> bool {
    let state = app_handle.state::<AppState>();
    let scan_inputs: Vec<(PathBuf, PathBuf, Option<String>)> = skill_roots
        .iter()
        .map(|root| {
            (
                root.skill_root.clone(),
                root.scan_root.clone(),
                root.agent_id.clone(),
            )
        })
        .collect();

    let entries = match SkillService::scan_skill_roots_batch(&scan_inputs) {
        Ok(entries) => entries,
        Err(e) => {
            eprintln!("Watcher incremental scan failed, falling back to full rebuild: {e}");
            return false;
        }
    };

    for entry in entries {
        if let Err(e) = SkillService::upsert_cache_entry(&state.skill_cache, entry) {
            eprintln!("Watcher incremental cache update failed, falling back to full rebuild: {e}");
            return false;
        }
    }

    true
}

async fn trigger_rebuild(app_handle: &tauri::AppHandle, event_count: usize, started: Instant) {
    let state = app_handle.state::<AppState>();
    match SkillService::rebuild_cache(&state.skill_cache, &state.metadata, &state.sync_in_progress)
        .await
    {
        Ok(_) => {
            let _ = app_handle.emit("skills-changed", ());
            eprintln!(
                "Watcher refresh full rebuild: {} event(s), {:?}",
                event_count,
                started.elapsed()
            );
        }
        Err(e) => {
            eprintln!("Watcher rebuild failed: {e}");
        }
    }
}

pub fn watch_external_path(state: &AppState, source_path: &Path) {
    if let Ok(mut guard) = state.fs_watcher.lock() {
        if let Some(watcher) = guard.as_mut() {
            if let Err(e) = watcher.watch(source_path, RecursiveMode::Recursive) {
                eprintln!(
                    "Failed to watch external import path {}: {e}",
                    source_path.display()
                );
            }
        }
    }
}

pub fn unwatch_external_path(state: &AppState, source_path: &Path) {
    if let Ok(mut guard) = state.fs_watcher.lock() {
        if let Some(watcher) = guard.as_mut() {
            if let Err(e) = watcher.unwatch(source_path) {
                eprintln!(
                    "Failed to unwatch external import path {}: {e}",
                    source_path.display()
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, DataChange, RemoveKind};

    fn event(kind: EventKind, path: PathBuf) -> Event {
        Event::new(kind).add_path(path)
    }

    fn ssot_root(path: PathBuf) -> WatchRoot {
        WatchRoot {
            path,
            kind: WatchRootKind::Ssot,
        }
    }

    fn agent_root(path: PathBuf) -> WatchRoot {
        WatchRoot {
            path,
            kind: WatchRootKind::Agent("codex".to_string()),
        }
    }

    fn archive_root(path: PathBuf) -> WatchRoot {
        WatchRoot {
            path,
            kind: WatchRootKind::Archive,
        }
    }

    #[test]
    fn classify_modify_skill_file_as_incremental() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path().join("skills");
        let skill = root.join("demo");
        std::fs::create_dir_all(&skill).expect("skill dir");
        let skill_md = skill.join("SKILL.md");
        std::fs::write(&skill_md, "# Demo").expect("skill md");

        let plan = classify_events(
            &[event(
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                skill_md,
            )],
            &[ssot_root(root.clone())],
        );

        assert_eq!(
            plan,
            RefreshPlan::Incremental(vec![SkillRoot {
                skill_root: skill,
                scan_root: root,
                agent_id: None,
            }])
        );
    }

    #[test]
    fn classify_nested_file_by_nearest_skill_root() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path().join("skills");
        let outer = root.join("outer");
        let inner = outer.join("examples").join("inner");
        std::fs::create_dir_all(&inner).expect("inner dir");
        std::fs::write(outer.join("SKILL.md"), "# Outer").expect("outer skill");
        std::fs::write(inner.join("SKILL.md"), "# Inner").expect("inner skill");
        let nested = inner.join("notes.md");
        std::fs::write(&nested, "notes").expect("notes");

        let plan = classify_events(
            &[event(
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                nested,
            )],
            &[ssot_root(root.clone())],
        );

        assert_eq!(
            plan,
            RefreshPlan::Incremental(vec![SkillRoot {
                skill_root: inner,
                scan_root: root,
                agent_id: None,
            }])
        );
    }

    #[test]
    fn classify_new_skill_md_as_incremental() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path().join("skills");
        let skill = root.join("new-skill");
        std::fs::create_dir_all(&skill).expect("skill dir");
        let skill_md = skill.join("SKILL.md");
        std::fs::write(&skill_md, "# New").expect("skill md");

        let plan = classify_events(
            &[event(EventKind::Create(CreateKind::File), skill_md)],
            &[ssot_root(root.clone())],
        );

        assert_eq!(
            plan,
            RefreshPlan::Incremental(vec![SkillRoot {
                skill_root: skill,
                scan_root: root,
                agent_id: None,
            }])
        );
    }

    #[test]
    fn classify_remove_as_full_rebuild() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path().join("skills");
        std::fs::create_dir_all(&root).expect("root");

        let plan = classify_events(
            &[event(
                EventKind::Remove(RemoveKind::File),
                root.join("demo").join("SKILL.md"),
            )],
            &[ssot_root(root)],
        );

        assert_eq!(plan, RefreshPlan::FullRebuild);
    }

    #[test]
    fn classify_archive_change_as_notify_only() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let archive = tmp.path().join("archive");
        std::fs::create_dir_all(&archive).expect("archive");

        let plan = classify_events(
            &[event(
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                archive.join("manifest.json"),
            )],
            &[archive_root(archive)],
        );

        assert_eq!(plan, RefreshPlan::NotifyOnly);
    }

    #[test]
    fn classify_skip_dir_change_as_noop() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path().join("skills");
        let skill = root.join("demo");
        let ignored = skill.join("node_modules");
        std::fs::create_dir_all(&ignored).expect("ignored dir");
        std::fs::write(skill.join("SKILL.md"), "# Demo").expect("skill md");
        let package_json = ignored.join("package.json");
        std::fs::write(&package_json, "{}").expect("package");

        let plan = classify_events(
            &[event(
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                package_json,
            )],
            &[ssot_root(root)],
        );

        assert_eq!(plan, RefreshPlan::Noop);
    }

    #[test]
    fn classify_full_rebuild_wins_over_incremental() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path().join("skills");
        let skill = root.join("demo");
        std::fs::create_dir_all(&skill).expect("skill dir");
        let skill_md = skill.join("SKILL.md");
        std::fs::write(&skill_md, "# Demo").expect("skill md");

        let plan = classify_events(
            &[
                event(
                    EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                    skill_md,
                ),
                event(EventKind::Remove(RemoveKind::Folder), root.join("old")),
            ],
            &[ssot_root(root)],
        );

        assert_eq!(plan, RefreshPlan::FullRebuild);
    }

    #[test]
    fn classify_agent_skill_with_agent_id() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path().join(".codex").join("skills");
        let skill = root.join("demo");
        std::fs::create_dir_all(&skill).expect("skill dir");
        let skill_md = skill.join("SKILL.md");
        std::fs::write(&skill_md, "# Demo").expect("skill md");

        let plan = classify_events(
            &[event(
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                skill_md,
            )],
            &[agent_root(root.clone())],
        );

        assert_eq!(
            plan,
            RefreshPlan::Incremental(vec![SkillRoot {
                skill_root: skill,
                scan_root: root,
                agent_id: Some("codex".to_string()),
            }])
        );
    }

    #[cfg(unix)]
    #[test]
    fn classify_agent_symlink_change_as_notify_only() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path().join(".codex").join("skills");
        let target = tmp.path().join("target-skill");
        let link = root.join("demo");
        std::fs::create_dir_all(&root).expect("root");
        std::fs::create_dir_all(&target).expect("target");
        std::os::unix::fs::symlink(&target, &link).expect("symlink");

        let plan = classify_events(
            &[event(EventKind::Create(CreateKind::Folder), link)],
            &[agent_root(root)],
        );

        assert_eq!(plan, RefreshPlan::NotifyOnly);
    }
}
