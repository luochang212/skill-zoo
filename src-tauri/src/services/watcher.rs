use crate::config;
use crate::persistence::SkillCache;
use crate::services::skill::SkillService;
use crate::store::AppState;
use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;

const DEBOUNCE_MS: u64 = 1500;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillsChangedPayload {
    updated: Vec<String>,
    removed: Vec<String>,
    full_rebuild: bool,
}

fn collect_watch_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let agents_dir = config::get_agents_skills_dir();
    if agents_dir.exists() {
        dirs.push(agents_dir);
    }
    for agent in config::AGENTS {
        if let Some(agent_dir) = config::get_agent_skills_dir(agent.id) {
            if agent_dir.exists() {
                dirs.push(agent_dir);
            }
        }
    }
    dirs
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
    let watch_dirs = collect_watch_dirs();
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
        let mut changed_paths: Vec<PathBuf> = Vec::new();

        // Wait for the first event
        if let Some(event) = rx.recv().await {
            changed_paths.extend(event.paths);
        } else {
            break;
        }

        // Debounce: collect all paths during the window, reset timer on each event
        let timer = tokio::time::sleep(Duration::from_millis(DEBOUNCE_MS));
        tokio::pin!(timer);
        loop {
            tokio::select! {
                maybe_event = rx.recv() => {
                    if let Some(event) = maybe_event {
                        changed_paths.extend(event.paths);
                        timer.as_mut().reset(
                            tokio::time::Instant::now() + Duration::from_millis(DEBOUNCE_MS),
                        );
                    } else {
                        return;
                    }
                }
                _ = &mut timer => {
                    break;
                }
            }
        }

        trigger_rebuild(&app_handle, &changed_paths).await;
    }
}

async fn trigger_rebuild(app_handle: &tauri::AppHandle, changed_paths: &[PathBuf]) {
    let state = app_handle.state::<AppState>();

    if changed_paths.is_empty() {
        return;
    }

    let (to_rescan, to_delete_candidates) =
        map_changed_paths_to_skill_dirs(changed_paths, &state.skill_cache, &collect_watch_dirs());

    if to_rescan.is_empty() && to_delete_candidates.is_empty() {
        return; // No skill affected (e.g. a non-skill file changed)
    }

    // Rescan affected skills
    let (entries, failed_dirs) = SkillService::scan_skills_batch(&to_rescan);

    // Verify deletions: re-check home_path existence to handle race conditions
    let mut remove_ids: HashSet<String> = to_delete_candidates
        .iter()
        .filter(|(_, hp)| !Path::new(hp).exists())
        .map(|(id, _)| id.clone())
        .collect();

    // Scan failures → treat as deletions
    for failed_dir in &failed_dirs {
        if let Some(id) = SkillService::find_id_by_directory(&state.skill_cache, failed_dir) {
            remove_ids.insert(id);
        }
    }

    let updated_ids: Vec<String> = entries.iter().map(|e| e.id.clone()).collect();

    // Batch update cache; on failure, fallback to full rebuild
    if let Err(e) =
        SkillService::batch_upsert_cache_entries(&state.skill_cache, entries, &remove_ids)
    {
        eprintln!(
            "Watcher incremental update failed, falling back to full rebuild: {e}"
        );
        match SkillService::rebuild_cache(
            &state.skill_cache,
            &state.metadata,
            &state.sync_in_progress,
        )
            .await
        {
            Ok(_) => {
                let _ = app_handle.emit(
                    "skills-changed",
                    SkillsChangedPayload {
                        updated: vec![],
                        removed: vec![],
                        full_rebuild: true,
                    },
                );
            }
            Err(e2) => {
                eprintln!("Watcher full rebuild also failed: {e2}");
                let _ = app_handle.emit(
                    "skills-changed",
                    SkillsChangedPayload {
                        updated: vec![],
                        removed: vec![],
                        full_rebuild: true,
                    },
                );
            }
        }
        return;
    }

    let _ = app_handle.emit(
        "skills-changed",
        SkillsChangedPayload {
            updated: updated_ids,
            removed: remove_ids.into_iter().collect(),
            full_rebuild: false,
        },
    );
}

/// Map filesystem change paths to affected skill directories.
/// Returns (to_rescan: Vec<relative_skill_dir>, to_delete: Vec<(skill_id, home_path)>)
fn map_changed_paths_to_skill_dirs(
    changed_paths: &[PathBuf],
    cache: &std::sync::RwLock<SkillCache>,
    watch_roots: &[PathBuf],
) -> (Vec<String>, Vec<(String, String)>) {

    // Resolve symlinks/junctions so Strategy A matches against real home_path.
    // Falls back to original path if canonicalize fails (e.g. deleted file).
    let resolved_paths: Vec<PathBuf> = changed_paths
        .iter()
        .map(|p| std::fs::canonicalize(p).unwrap_or_else(|_| p.clone()))
        .collect();

    let cached_skills: Vec<(String, String, String)> = cache
        .read()
        .map(|c| {
            c.skills
                .iter()
                .filter_map(|s| {
                    s.home_path
                        .as_ref()
                        .map(|hp| (s.id.clone(), s.directory.clone(), hp.clone()))
                })
                .collect()
        })
        .unwrap_or_default();

    // Sort by home_path length descending so longest match wins for nested skills
    let mut sorted = cached_skills;
    sorted.sort_by(|a, b| b.2.len().cmp(&a.2.len()));

    let mut to_rescan: HashSet<String> = HashSet::new();
    let mut to_delete: Vec<(String, String)> = Vec::new();
    let mut matched_paths: HashSet<usize> = HashSet::new();

    // Strategy A: match resolved paths against cached skills' home_path
    for (i, path) in resolved_paths.iter().enumerate() {
        for (id, dir, hp) in &sorted {
            if path.starts_with(hp) {
                matched_paths.insert(i);
                if Path::new(hp).exists() {
                    to_rescan.insert(dir.clone());
                } else {
                    to_delete.push((id.clone(), hp.clone()));
                }
                break; // longest match first
            }
        }
    }

    // Strategy B: walk up unmatched *original* paths to find SKILL.md ancestor.
    // Uses original paths (not canonicalized) so strip_prefix works with watch roots.
    for (i, path) in changed_paths.iter().enumerate() {
        if matched_paths.contains(&i) {
            continue;
        }
        if let Some(skill_dir) = walk_up_to_skill(path, &watch_roots) {
            to_rescan.insert(skill_dir);
        }
    }

    (to_rescan.into_iter().collect(), to_delete)
}

/// Walk up from a changed path until finding a directory containing SKILL.md.
/// Returns the skill directory relative to its watch root.
fn walk_up_to_skill(path: &Path, watch_roots: &[PathBuf]) -> Option<String> {
    let mut current = path;
    while let Some(parent) = current.parent() {
        // Don't walk above or on the watch root itself
        if watch_roots.iter().any(|r| current == r.as_path()) {
            break;
        }
        if current.join("SKILL.md").exists() {
            // Found a skill dir — return relative path from its watch root
            for root in watch_roots {
                if let Ok(rel) = current.strip_prefix(root) {
                    return Some(rel.to_str()?.to_string());
                }
            }
        }
        // Stop at watch root boundary — don't walk above watched directories
        if watch_roots.iter().any(|r| parent == r.as_path()) {
            break;
        }
        current = parent;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::SkillCacheEntry;

    /// Helper: create a SkillCache with given entries inside an RwLock
    fn make_cache(entries: Vec<SkillCacheEntry>) -> std::sync::RwLock<SkillCache> {
        std::sync::RwLock::new(SkillCache { skills: entries })
    }

    /// Helper: create a minimal SkillCacheEntry
    fn make_entry(id: &str, directory: &str, home_path: &str) -> SkillCacheEntry {
        SkillCacheEntry {
            id: id.to_string(),
            name: id.to_string(),
            yaml_name: None,
            description: None,
            directory: directory.to_string(),
            repo_owner: None,
            repo_name: None,
            source_url: None,
            origin: "ssot".to_string(),
            home_path: Some(home_path.to_string()),
            content_hash: None,
            home_agent: None,
            installed_at: 0,
            updated_at: 0,
        }
    }

    // ─── walk_up_to_skill ───

    #[test]
    fn walk_up_finds_skill_dir_from_deep_file() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        // Create skill structure: root/owner/skill/SKILL.md
        let skill_dir = root.join("owner").join("skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "---\nname: test\n---").unwrap();

        // Deep file: root/owner/skill/lib/utils.sh
        let deep_file = skill_dir.join("lib").join("utils.sh");

        let result = walk_up_to_skill(&deep_file, &[root.to_path_buf()]);
        assert_eq!(result, Some("owner/skill".to_string()));
    }

    #[test]
    fn walk_up_returns_none_when_no_skill_md() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        // No SKILL.md anywhere
        let some_dir = root.join("random");
        std::fs::create_dir_all(&some_dir).unwrap();

        let result = walk_up_to_skill(&some_dir, &[root.to_path_buf()]);
        assert_eq!(result, None);
    }

    #[test]
    fn walk_up_stops_at_watch_root() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        // SKILL.md outside the watch root (shouldn't be found)
        let _outside = tmp.path().parent().unwrap();
        // We can't reliably create files outside the tempdir,
        // so this test just verifies the function doesn't panic
        // and returns None for paths at the root boundary.
        let file_at_root = root.join("some_file.txt");
        std::fs::write(&file_at_root, "test").unwrap();

        let result = walk_up_to_skill(&file_at_root, &[root.to_path_buf()]);
        assert_eq!(result, None);
    }

    // ─── map_changed_paths_to_skill_dirs ───

    #[test]
    fn strategy_a_matches_existing_skill() {
        let tmp = tempfile::tempdir().unwrap();
        let skill_path = std::fs::canonicalize(tmp.path().join("my-skill"))
            .unwrap_or_else(|_| tmp.path().join("my-skill").clone());
        // Fall back to non-canonicalized path if dir doesn't exist yet
        let skill_path = if skill_path.exists() {
            skill_path
        } else {
            let p = tmp.path().join("my-skill");
            std::fs::create_dir_all(&p).unwrap();
            std::fs::write(p.join("SKILL.md"), "---\nname: test\n---").unwrap();
            std::fs::canonicalize(&p).unwrap_or(p)
        };

        let cache = make_cache(vec![make_entry(
            "ssot:my-skill",
            "my-skill",
            skill_path.to_str().unwrap(),
        )]);

        let changed = vec![skill_path.join("SKILL.md")];
        let (rescan, delete) =
            map_changed_paths_to_skill_dirs(&changed, &cache, &[skill_path.parent().unwrap().to_path_buf()]);

        assert_eq!(rescan, vec!["my-skill".to_string()]);
        assert!(delete.is_empty());
    }

    #[test]
    fn strategy_a_detects_deleted_skill() {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap_or_else(|_| tmp.path().to_path_buf());
        // home_path points to a directory that doesn't exist (simulates deletion)
        let skill_path = root.join("deleted-skill");
        // Don't create this directory — it's "deleted"

        let cache = make_cache(vec![make_entry(
            "ssot:deleted-skill",
            "deleted-skill",
            skill_path.to_str().unwrap(),
        )]);

        // notify might report the path of a file inside the now-deleted dir
        // canonicalize will fail, so it falls back to the original path
        let changed = vec![skill_path.join("SKILL.md")];
        let (rescan, delete) =
            map_changed_paths_to_skill_dirs(&changed, &cache, &[root]);

        assert!(rescan.is_empty());
        assert_eq!(delete.len(), 1);
        assert_eq!(delete[0].0, "ssot:deleted-skill");
    }

    #[test]
    fn strategy_b_finds_new_skill() {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap_or_else(|_| tmp.path().to_path_buf());

        // New skill not in cache yet
        let skill_dir = root.join("new-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "---\nname: new\n---").unwrap();

        let cache = make_cache(vec![]); // Empty cache — no existing skills

        let changed = vec![skill_dir.join("SKILL.md")];
        let (rescan, delete) =
            map_changed_paths_to_skill_dirs(&changed, &cache, &[root.clone()]);

        assert_eq!(rescan, vec!["new-skill".to_string()]);
        assert!(delete.is_empty());
    }

    #[test]
    fn nested_skill_gets_longest_match() {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap_or_else(|_| tmp.path().to_path_buf());
        let shallow_path = root.join("owner");
        let deep_path = root.join("owner").join("skill");
        std::fs::create_dir_all(&shallow_path).unwrap();
        std::fs::create_dir_all(&deep_path).unwrap();
        std::fs::write(shallow_path.join("SKILL.md"), "---\nname: owner-skill\n---").unwrap();
        std::fs::write(deep_path.join("SKILL.md"), "---\nname: deep-skill\n---").unwrap();

        let cache = make_cache(vec![
            make_entry("ssot:owner", "owner", shallow_path.to_str().unwrap()),
            make_entry("ssot:owner/skill", "owner/skill", deep_path.to_str().unwrap()),
        ]);

        // Change inside the deep skill
        let changed = vec![deep_path.join("lib").join("utils.sh")];
        let (rescan, delete) =
            map_changed_paths_to_skill_dirs(&changed, &cache, &[root]);

        // Longest match should pick "owner/skill", not "owner"
        assert!(rescan.contains(&"owner/skill".to_string()));
        assert!(delete.is_empty());
    }

    // ─── batch_upsert_cache_entries ───

    /// Helper: verify in-memory cache state after batch_upsert, skipping save
    /// (save writes to the real ~/.skill-zoo/ which causes test races).
    /// Must stay in sync with SkillService::batch_upsert_cache_entries logic.
    fn verify_batch_upsert(
        cache: &std::sync::RwLock<SkillCache>,
        entries: Vec<SkillCacheEntry>,
        remove_ids: &HashSet<String>,
    ) {
        let mut c = cache.write().unwrap();
        if !remove_ids.is_empty() {
            c.skills.retain(|s| !remove_ids.contains(&s.id));
        }
        for entry in entries {
            if let Some(existing) = c.skills.iter_mut().find(|s| s.id == entry.id) {
                // Skip if cache was updated more recently (e.g. by a concurrent full rebuild)
                if existing.updated_at >= entry.updated_at {
                    continue;
                }
                let installed_at = existing.installed_at;
                *existing = entry;
                existing.installed_at = installed_at;
            } else {
                c.skills.push(entry);
            }
        }
        // Don't call c.save() — that hits the real filesystem
    }

    #[test]
    fn batch_upsert_preserves_installed_at() {
        let cache = make_cache(vec![SkillCacheEntry {
            id: "ssot:old".to_string(),
            name: "old".to_string(),
            yaml_name: None,
            description: None,
            directory: "old".to_string(),
            repo_owner: None,
            repo_name: None,
            source_url: None,
            origin: "ssot".to_string(),
            home_path: None,
            content_hash: None,
            home_agent: None,
            installed_at: 100, // should be preserved
            updated_at: 200,
        }]);

        let new_entry = SkillCacheEntry {
            id: "ssot:old".to_string(), // same ID
            name: "old-updated".to_string(),
            yaml_name: None,
            description: Some("new desc".to_string()),
            directory: "old".to_string(),
            repo_owner: None,
            repo_name: None,
            source_url: None,
            origin: "ssot".to_string(),
            home_path: None,
            content_hash: None,
            home_agent: None,
            installed_at: 0, // should NOT overwrite
            updated_at: 300,
        };

        let remove_ids = HashSet::new();
        verify_batch_upsert(&cache, vec![new_entry], &remove_ids);

        let c = cache.read().unwrap();
        let entry = c.skills.iter().find(|s| s.id == "ssot:old").unwrap();
        assert_eq!(entry.installed_at, 100); // preserved
        assert_eq!(entry.updated_at, 300); // updated
        assert_eq!(entry.name, "old-updated");
    }

    #[test]
    fn batch_upsert_removes_entries() {
        let cache = make_cache(vec![
            make_entry("ssot:keep", "keep", "/fake/keep"),
            make_entry("ssot:remove", "remove", "/fake/remove"),
        ]);

        let mut remove_ids = HashSet::new();
        remove_ids.insert("ssot:remove".to_string());

        verify_batch_upsert(&cache, vec![], &remove_ids);

        let c = cache.read().unwrap();
        assert_eq!(c.skills.len(), 1);
        assert_eq!(c.skills[0].id, "ssot:keep");
    }

    #[test]
    fn batch_upsert_adds_new_entry() {
        let cache = make_cache(vec![make_entry("ssot:existing", "existing", "/fake/existing")]);

        let new_entry = make_entry("ssot:new", "new", "/fake/new");
        let remove_ids = HashSet::new();

        verify_batch_upsert(&cache, vec![new_entry], &remove_ids);

        let c = cache.read().unwrap();
        assert_eq!(c.skills.len(), 2);
        assert!(c.skills.iter().any(|s| s.id == "ssot:new"));
    }

    #[test]
    fn batch_upsert_skips_stale_entries() {
        // Cache has updated_at=200 (fresher, e.g. from a concurrent full rebuild)
        let mut cached = make_entry("ssot:skill", "skill", "/fake/skill");
        cached.updated_at = 200;

        let cache = make_cache(vec![cached]);

        // Incoming entry has updated_at=100 (stale, from an earlier scan)
        let mut stale_entry = make_entry("ssot:skill", "skill", "/fake/skill");
        stale_entry.updated_at = 100;
        stale_entry.name = "stale-name".to_string(); // would overwrite if not skipped

        let remove_ids = HashSet::new();
        verify_batch_upsert(&cache, vec![stale_entry], &remove_ids);

        let c = cache.read().unwrap();
        let entry = c.skills.iter().find(|s| s.id == "ssot:skill").unwrap();
        assert_eq!(entry.updated_at, 200); // not overwritten
        assert_ne!(entry.name, "stale-name"); // stale write was skipped
    }

    #[test]
    fn batch_upsert_allows_fresher_entries() {
        // Cache has updated_at=100
        let mut cached = make_entry("ssot:skill", "skill", "/fake/skill");
        cached.updated_at = 100;
        cached.name = "old-name".to_string();

        let cache = make_cache(vec![cached]);

        // Incoming entry has updated_at=200 (fresher)
        let mut fresh_entry = make_entry("ssot:skill", "skill", "/fake/skill");
        fresh_entry.updated_at = 200;
        fresh_entry.name = "fresh-name".to_string();

        let remove_ids = HashSet::new();
        verify_batch_upsert(&cache, vec![fresh_entry], &remove_ids);

        let c = cache.read().unwrap();
        let entry = c.skills.iter().find(|s| s.id == "ssot:skill").unwrap();
        assert_eq!(entry.updated_at, 200); // updated
        assert_eq!(entry.name, "fresh-name"); // fresher write went through
    }

    // ─── find_id_by_directory ───

    #[test]
    fn find_id_by_directory_returns_id() {
        let cache = make_cache(vec![make_entry("ssot:my-skill", "my-skill", "/fake/my-skill")]);
        let result = SkillService::find_id_by_directory(&cache, "my-skill");
        assert_eq!(result, Some("ssot:my-skill".to_string()));
    }

    #[test]
    fn find_id_by_directory_returns_none_for_missing() {
        let cache = make_cache(vec![make_entry("ssot:my-skill", "my-skill", "/fake/my-skill")]);
        let result = SkillService::find_id_by_directory(&cache, "nonexistent");
        assert_eq!(result, None);
    }
}