use crate::config;
use crate::persistence::SkillCache;
use crate::services::skill::SkillService;
use crate::store::AppState;
use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;

const DEBOUNCE_MS: u64 = 1500;

// ──────────────────────────────────────────────
//  Event coalescing
// ──────────────────────────────────────────────

/// Simplified change type for coalescing filesystem events.
/// Inspired by VSCode's EventCoalescer — tracks the net effect of
/// multiple events on the same path within a debounce window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ChangeKind {
    Create,
    Modify,
    Delete,
}

/// Per-path coalescing: tracks the net effect of all events for a path
/// within a single debounce window.
///
/// Merge rules (matching VSCode's EventCoalescer):
///   Create + Delete → remove entry (nothing happened)
///   Delete + Create → Modify     (file was replaced, e.g. atomic save)
///   Create + Modify → Create     (still just created)
///   Modify + Delete → Delete     (modified then deleted)
///   Any   + Same    → no change  (idempotent)
struct PathCoalescer {
    entries: HashMap<PathBuf, ChangeKind>,
}

impl PathCoalescer {
    fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    /// Record a change event for `path`, merging with any existing entry.
    fn record(&mut self, path: PathBuf, kind: ChangeKind) {
        use ChangeKind::*;
        if let Some(existing) = self.entries.get_mut(&path) {
            match (*existing, kind) {
                (Create, Delete) => {
                    // Cancel out — remove the entry entirely
                    self.entries.remove(&path);
                }
                (Delete, Create) => *existing = Modify, // replaced
                (Create, Modify) => {}                  // still just created
                (Modify, Delete) => *existing = Delete, // modified then deleted
                _ => {}                                 // idempotent / no-op
            }
        } else {
            self.entries.insert(path, kind);
        }
    }

    /// After all events are recorded, simplify: if a parent directory has a
    /// Delete event, drop child Delete events (the parent already covers them).
    /// Matches VSCode's "only keep parent DELETE" rule.
    fn simplify(&mut self) {
        let parent_deletes: Vec<PathBuf> = self
            .entries
            .iter()
            .filter(|(_, k)| **k == ChangeKind::Delete)
            .filter(|(p, _)| p.is_dir() || p.extension().is_none())
            .map(|(p, _)| p.clone())
            .collect();

        for parent in &parent_deletes {
            self.entries.retain(|path, kind| {
                // Keep if not a child of a deleted parent, or if not a Delete
                if *kind == ChangeKind::Delete && path.starts_with(parent) && path != parent {
                    return false;
                }
                true
            });
        }
    }

    /// Return the coalesced entries, consuming the coalescer.
    fn into_entries(self) -> HashMap<PathBuf, ChangeKind> {
        self.entries
    }
}

// ──────────────────────────────────────────────
//  Payload
// ──────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillsChangedPayload {
    updated: Vec<String>,
    removed: Vec<String>,
    full_rebuild: bool,
}

/// Result of mapping coalesced filesystem events to affected skills.
struct AffectedSkills {
    /// Skill directories (relative to watch root) that need rescanning.
    to_rescan: HashSet<String>,
    /// Skill IDs that should be removed from the cache.
    to_delete: HashSet<String>,
}

// ──────────────────────────────────────────────
//  Watcher setup
// ──────────────────────────────────────────────

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

// ──────────────────────────────────────────────
//  Debounce loop
// ──────────────────────────────────────────────

/// Classify a notify EventKind into our simplified ChangeKind.
fn classify_event_kind(kind: &EventKind) -> Option<ChangeKind> {
    match kind {
        EventKind::Create(_) => Some(ChangeKind::Create),
        EventKind::Modify(_) => Some(ChangeKind::Modify),
        EventKind::Remove(_) => Some(ChangeKind::Delete),
        EventKind::Access(_) | EventKind::Other | EventKind::Any => None,
    }
}

async fn debounced_rebuild_loop(
    mut rx: tokio::sync::mpsc::Receiver<Event>,
    app_handle: tauri::AppHandle,
) {
    loop {
        let mut coalescer = PathCoalescer::new();

        // Wait for the first event
        if let Some(event) = rx.recv().await {
            if let Some(kind) = classify_event_kind(&event.kind) {
                for path in event.paths {
                    coalescer.record(path, kind);
                }
            }
        } else {
            break;
        }

        // Debounce: collect and coalesce all events during the window
        let timer = tokio::time::sleep(Duration::from_millis(DEBOUNCE_MS));
        tokio::pin!(timer);
        loop {
            tokio::select! {
                maybe_event = rx.recv() => {
                    if let Some(event) = maybe_event {
                        if let Some(kind) = classify_event_kind(&event.kind) {
                            for path in event.paths {
                                coalescer.record(path, kind);
                            }
                        }
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

        coalescer.simplify();
        let coalesced = coalescer.into_entries();

        if !coalesced.is_empty() {
            trigger_rebuild(&app_handle, &coalesced).await;
        }
    }
}

// ──────────────────────────────────────────────
//  Rebuild logic
// ──────────────────────────────────────────────

async fn trigger_rebuild(
    app_handle: &tauri::AppHandle,
    coalesced: &HashMap<PathBuf, ChangeKind>,
) {
    let state = app_handle.state::<AppState>();
    let watch_roots = collect_watch_dirs();

    let affected = resolve_affected_skills(coalesced, &state.skill_cache, &watch_roots);

    if affected.to_rescan.is_empty() && affected.to_delete.is_empty() {
        return;
    }

    let to_rescan: Vec<String> = affected.to_rescan.into_iter().collect();
    let mut remove_ids: HashSet<String> = affected.to_delete;

    // Verify deletions: re-check that home_path still doesn't exist
    {
        let cache = state.skill_cache.read().unwrap();
        remove_ids.retain(|id| {
            let entry = cache.skills.iter().find(|s| &s.id == id);
            entry.is_none()
                || entry
                    .unwrap()
                    .home_path
                    .as_ref()
                    .is_none_or(|hp| !Path::new(hp).exists())
        });
    }

    // Look up IDs for scan-failed directories in one read-lock acquisition
    let failed_dir_ids = SkillService::find_ids_by_directories(&state.skill_cache, &to_rescan);

    // Move scan + cache update off the tokio runtime.
    // We pass a raw pointer to the skill_cache RwLock — safe because AppState
    // outlives the app and spawn_blocking runs on a thread in the same process.
    let skill_cache_ptr = &state.skill_cache as *const _ as usize;

    let result = tokio::task::spawn_blocking(move || {
        let skill_cache: &RwLock<SkillCache> = unsafe { &*(skill_cache_ptr as *const _) };

        let (entries, failed_dirs) = SkillService::scan_skills_batch(&to_rescan);

        for failed_dir in &failed_dirs {
            if let Some(id) = failed_dir_ids.get(failed_dir) {
                remove_ids.insert(id.clone());
            }
        }

        let updated_ids: Vec<String> = entries.iter().map(|e| e.id.clone()).collect();

        match SkillService::batch_upsert_cache_entries(skill_cache, entries, &remove_ids) {
            Ok(()) => Ok((updated_ids, remove_ids)),
            Err(e) => {
                eprintln!("Watcher incremental update failed: {e}");
                Err(())
            }
        }
    })
    .await;

    match result {
        Ok(Ok((updated_ids, remove_ids))) => {
            let _ = app_handle.emit(
                "skills-changed",
                SkillsChangedPayload {
                    updated: updated_ids,
                    removed: remove_ids.into_iter().collect(),
                    full_rebuild: false,
                },
            );
        }
        _ => {
            // Incremental failed or spawn_blocking panicked — do full rebuild
            if let Err(e2) = SkillService::rebuild_cache(
                &state.skill_cache,
                &state.metadata,
                &state.sync_in_progress,
            )
            .await
            {
                eprintln!("Watcher full rebuild also failed: {e2}");
            }
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
}

// ──────────────────────────────────────────────
//  Path → skill mapping
// ──────────────────────────────────────────────

/// Map coalesced filesystem events to affected skill directories.
///
/// Strategy A (existing skills): For paths that still exist on disk,
/// canonicalize and match against cached skills' `home_path` (longest prefix).
///
/// Strategy A' (deleted skills): For paths that no longer exist,
/// strip the watch root prefix and match by `directory` field in cache.
/// This avoids the canonicalize-fails-for-deleted-files bug.
///
/// Strategy B (new skills): Walk up unmatched paths to find a SKILL.md ancestor.
fn resolve_affected_skills(
    coalesced: &HashMap<PathBuf, ChangeKind>,
    cache: &std::sync::RwLock<SkillCache>,
    watch_roots: &[PathBuf],
) -> AffectedSkills {
    // Cache snapshot: (id, directory, home_path)
    let cached_skills: Vec<(String, String, Option<String>)> = cache
        .read()
        .map(|c| {
            c.skills
                .iter()
                .map(|s| (s.id.clone(), s.directory.clone(), s.home_path.clone()))
                .collect()
        })
        .unwrap_or_default();

    // Sort by home_path length descending so longest match wins for nested skills
    let mut sorted_by_homepath: Vec<(String, String, String)> = cached_skills
        .iter()
        .filter_map(|(id, dir, hp)| hp.as_ref().map(|h| (id.clone(), dir.clone(), h.clone())))
        .collect();
    sorted_by_homepath.sort_by(|a, b| b.2.len().cmp(&a.2.len()));

    // Build a map from directory → id for deletion lookup
    let dir_to_id: HashMap<&str, &str> = cached_skills
        .iter()
        .map(|(id, dir, _)| (dir.as_str(), id.as_str()))
        .collect();

    let mut to_rescan: HashSet<String> = HashSet::new();
    let mut to_delete: HashSet<String> = HashSet::new();
    let mut matched_paths: HashSet<PathBuf> = HashSet::new();

    for (path, kind) in coalesced {
        if path.exists() {
            // Path still exists — Strategy A: canonicalize and match home_path
            if let Ok(resolved) = std::fs::canonicalize(path) {
                for (_id, dir, hp) in &sorted_by_homepath {
                    if resolved.starts_with(hp) {
                        matched_paths.insert(path.clone());
                        to_rescan.insert(dir.clone());
                        break; // longest match first
                    }
                }
            }
        } else {
            // Path no longer exists — Strategy A': match by directory field
            // Strip watch root prefix to get relative path, then look up in cache
            for root in watch_roots {
                if let Ok(rel) = path.strip_prefix(root) {
                    let rel_str = rel.to_string_lossy();
                    // The relative path might be "owner/skill/SKILL.md" or
                    // "owner/skill/lib/utils.sh". Walk up to find a matching directory.
                    let mut candidate = Path::new(rel_str.as_ref());
                    loop {
                        let candidate_str = candidate.to_str().unwrap_or("");
                        if dir_to_id.contains_key(candidate_str) {
                            matched_paths.insert(path.clone());
                            // Always rescan — never assume deletion just because
                            // a file inside the skill was deleted. The scanner
                            // will detect whether the skill directory still exists:
                            // scan succeeds → skill alive, entry updated
                            // scan fails    → skill gone, added to remove_ids
                            to_rescan.insert(candidate_str.to_string());
                            break;
                        }
                        match candidate.parent() {
                            Some(p) if !p.as_os_str().is_empty() => candidate = p,
                            _ => break,
                        }
                    }
                    break; // found the matching watch root
                }
            }
        }
    }

    // Strategy B: walk up unmatched paths to find SKILL.md ancestor.
    // Only for Create/Modify events (new skill discovery).
    // Delete events for unknown paths are irrelevant.
    for (path, kind) in coalesced {
        if matched_paths.contains(path) {
            continue;
        }
        if *kind == ChangeKind::Delete {
            continue; // Can't discover a new skill via a deletion event
        }
        if let Some(skill_dir) = walk_up_to_skill(path, watch_roots) {
            to_rescan.insert(skill_dir);
        }
    }

    AffectedSkills {
        to_rescan,
        to_delete,
    }
}

/// Walk up from a changed path until finding a directory containing SKILL.md.
/// Returns the skill directory relative to its watch root.
///
/// Checks for SKILL.md *before* checking the root boundary, so a skill
/// at the watch root level is discovered correctly.
fn walk_up_to_skill(path: &Path, watch_roots: &[PathBuf]) -> Option<String> {
    let mut current = path;
    while let Some(parent) = current.parent() {
        // Check for SKILL.md before checking root boundary
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

// ──────────────────────────────────────────────
//  Tests
// ──────────────────────────────────────────────

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

    // ─── PathCoalescer ───

    #[test]
    fn coalesce_create_then_delete_cancels() {
        let mut c = PathCoalescer::new();
        let path = PathBuf::from("/tmp/skill/SKILL.md");
        c.record(path.clone(), ChangeKind::Create);
        c.record(path.clone(), ChangeKind::Delete);
        let entries = c.into_entries();
        assert!(!entries.contains_key(&path));
    }

    #[test]
    fn coalesce_delete_then_create_becomes_modify() {
        let mut c = PathCoalescer::new();
        let path = PathBuf::from("/tmp/skill/SKILL.md");
        c.record(path.clone(), ChangeKind::Delete);
        c.record(path.clone(), ChangeKind::Create);
        let entries = c.into_entries();
        assert_eq!(entries.get(&path), Some(&ChangeKind::Modify));
    }

    #[test]
    fn coalesce_create_then_modify_stays_create() {
        let mut c = PathCoalescer::new();
        let path = PathBuf::from("/tmp/skill/SKILL.md");
        c.record(path.clone(), ChangeKind::Create);
        c.record(path.clone(), ChangeKind::Modify);
        let entries = c.into_entries();
        assert_eq!(entries.get(&path), Some(&ChangeKind::Create));
    }

    #[test]
    fn coalesce_modify_then_delete_becomes_delete() {
        let mut c = PathCoalescer::new();
        let path = PathBuf::from("/tmp/skill/SKILL.md");
        c.record(path.clone(), ChangeKind::Modify);
        c.record(path.clone(), ChangeKind::Delete);
        let entries = c.into_entries();
        assert_eq!(entries.get(&path), Some(&ChangeKind::Delete));
    }

    #[test]
    fn coalesce_same_kind_idempotent() {
        let mut c = PathCoalescer::new();
        let path = PathBuf::from("/tmp/skill/SKILL.md");
        c.record(path.clone(), ChangeKind::Modify);
        c.record(path.clone(), ChangeKind::Modify);
        let entries = c.into_entries();
        assert_eq!(entries.get(&path), Some(&ChangeKind::Modify));
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn coalesce_simplify_drops_child_deletes_under_parent_delete() {
        let mut c = PathCoalescer::new();
        let parent = PathBuf::from("/tmp/skill");
        let child1 = PathBuf::from("/tmp/skill/SKILL.md");
        let child2 = PathBuf::from("/tmp/skill/lib/utils.sh");
        c.record(parent.clone(), ChangeKind::Delete);
        c.record(child1.clone(), ChangeKind::Delete);
        c.record(child2.clone(), ChangeKind::Delete);
        c.simplify();
        let entries = c.into_entries();
        // Parent delete kept, children dropped
        assert_eq!(entries.get(&parent), Some(&ChangeKind::Delete));
        assert!(!entries.contains_key(&child1));
        assert!(!entries.contains_key(&child2));
    }

    #[test]
    fn coalesce_simplify_keeps_child_modifies_under_parent_delete() {
        let mut c = PathCoalescer::new();
        let parent = PathBuf::from("/tmp/skill");
        let child = PathBuf::from("/tmp/skill/SKILL.md");
        c.record(parent.clone(), ChangeKind::Delete);
        c.record(child.clone(), ChangeKind::Modify); // shouldn't happen, but test it
        c.simplify();
        let entries = c.into_entries();
        assert!(entries.contains_key(&parent));
        assert!(entries.contains_key(&child)); // non-Delete children are kept
    }

    // ─── walk_up_to_skill ───

    #[test]
    fn walk_up_finds_skill_dir_from_deep_file() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        let skill_dir = root.join("owner").join("skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "---\nname: test\n---").unwrap();

        let deep_file = skill_dir.join("lib").join("utils.sh");

        let result = walk_up_to_skill(&deep_file, &[root.to_path_buf()]);
        assert_eq!(result, Some("owner/skill".to_string()));
    }

    #[test]
    fn walk_up_returns_none_when_no_skill_md() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        let some_dir = root.join("random");
        std::fs::create_dir_all(&some_dir).unwrap();

        let result = walk_up_to_skill(&some_dir, &[root.to_path_buf()]);
        assert_eq!(result, None);
    }

    #[test]
    fn walk_up_stops_at_watch_root() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        let file_at_root = root.join("some_file.txt");
        std::fs::write(&file_at_root, "test").unwrap();

        let result = walk_up_to_skill(&file_at_root, &[root.to_path_buf()]);
        assert_eq!(result, None);
    }

    #[test]
    fn walk_up_finds_skill_at_watch_root_level() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        // A skill directly under the watch root
        let skill_dir = root.join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "---\nname: test\n---").unwrap();

        // A file inside the skill
        let file = skill_dir.join("lib.sh");
        std::fs::write(&file, "echo hi").unwrap();

        let result = walk_up_to_skill(&file, &[root.to_path_buf()]);
        assert_eq!(result, Some("my-skill".to_string()));
    }

    // ─── resolve_affected_skills ───

    #[test]
    fn strategy_a_matches_existing_skill() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let skill_path = root.join("my-skill");
        std::fs::create_dir_all(&skill_path).unwrap();
        std::fs::write(skill_path.join("SKILL.md"), "---\nname: test\n---").unwrap();

        let canonical = std::fs::canonicalize(&skill_path).unwrap_or_else(|_| skill_path.clone());

        let cache = make_cache(vec![make_entry(
            "ssot:my-skill",
            "my-skill",
            canonical.to_str().unwrap(),
        )]);

        let mut coalesced = HashMap::new();
        coalesced.insert(skill_path.join("SKILL.md"), ChangeKind::Modify);

        let affected = resolve_affected_skills(&coalesced, &cache, &[root.to_path_buf()]);
        assert!(affected.to_rescan.contains("my-skill"));
        assert!(affected.to_delete.is_empty());
    }

    #[test]
    fn strategy_a_prime_matches_deleted_path_and_flags_rescan() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let root_canonical =
            std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());

        // Skill existed in cache but directory is gone (e.g. deleted)
        let skill_path = root_canonical.join("deleted-skill");

        let cache = make_cache(vec![make_entry(
            "ssot:deleted-skill",
            "deleted-skill",
            skill_path.to_str().unwrap(),
        )]);

        let mut coalesced = HashMap::new();
        coalesced.insert(skill_path.join("SKILL.md"), ChangeKind::Delete);

        let affected = resolve_affected_skills(&coalesced, &cache, &[root_canonical]);
        // Always rescan — deletion is verified by scan_skills_batch failure
        assert!(affected.to_rescan.contains("deleted-skill"));
        assert!(affected.to_delete.is_empty());
    }

    #[test]
    fn strategy_a_prime_file_deleted_inside_existing_skill() {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap_or_else(|_| tmp.path().to_path_buf());

        // Skill directory exists on disk
        let skill_dir = root.join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "---\nname: test\n---").unwrap();

        let cache = make_cache(vec![make_entry(
            "ssot:my-skill",
            "my-skill",
            skill_dir.to_str().unwrap(),
        )]);

        // A file inside the skill was deleted (path no longer exists on disk)
        let deleted_file = skill_dir.join("helper.sh");
        // Don't create helper.sh — it was "deleted"

        let mut coalesced = HashMap::new();
        coalesced.insert(deleted_file.clone(), ChangeKind::Delete);

        let affected = resolve_affected_skills(&coalesced, &cache, &[root.clone()]);
        // Skill directory still exists → should rescan, not delete
        assert!(affected.to_rescan.contains("my-skill"));
        assert!(affected.to_delete.is_empty());
    }

    #[test]
    fn strategy_b_finds_new_skill() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        // New skill not in cache yet
        let skill_dir = root.join("new-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "---\nname: new\n---").unwrap();

        let cache = make_cache(vec![]);

        let mut coalesced = HashMap::new();
        coalesced.insert(skill_dir.join("SKILL.md"), ChangeKind::Create);

        let affected = resolve_affected_skills(&coalesced, &cache, &[root.to_path_buf()]);
        assert!(affected.to_rescan.contains("new-skill"));
        assert!(affected.to_delete.is_empty());
    }

    #[test]
    fn nested_skill_gets_longest_match() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let shallow_path = root.join("owner");
        let deep_path = root.join("owner").join("skill");
        std::fs::create_dir_all(&shallow_path).unwrap();
        std::fs::create_dir_all(&deep_path).unwrap();
        std::fs::write(shallow_path.join("SKILL.md"), "---\nname: owner-skill\n---").unwrap();
        std::fs::write(deep_path.join("SKILL.md"), "---\nname: deep-skill\n---").unwrap();

        let cache = make_cache(vec![
            make_entry(
                "ssot:owner",
                "owner",
                std::fs::canonicalize(&shallow_path)
                    .unwrap_or_else(|_| shallow_path.clone())
                    .to_str()
                    .unwrap(),
            ),
            make_entry(
                "ssot:owner/skill",
                "owner/skill",
                std::fs::canonicalize(&deep_path)
                    .unwrap_or_else(|_| deep_path.clone())
                    .to_str()
                    .unwrap(),
            ),
        ]);

        let mut coalesced = HashMap::new();
        coalesced.insert(deep_path.join("lib").join("utils.sh"), ChangeKind::Modify);

        let affected = resolve_affected_skills(&coalesced, &cache, &[root.to_path_buf()]);
        // Longest match should pick "owner/skill", not "owner"
        assert!(affected.to_rescan.contains("owner/skill"));
        assert!(!affected.to_rescan.contains("owner"));
        assert!(affected.to_delete.is_empty());
    }

    #[test]
    fn create_then_delete_cancels_rescan() {
        // If CREATE+DELETE cancel out in the coalescer, no skill should be affected
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let skill_path = root.join("my-skill");
        std::fs::create_dir_all(&skill_path).unwrap();
        std::fs::write(skill_path.join("SKILL.md"), "---\nname: test\n---").unwrap();

        let cache = make_cache(vec![]);

        // Coalescer cancels CREATE+DELETE, so the map is empty
        let coalesced = HashMap::new(); // CREATE+DELETE was cancelled

        let affected = resolve_affected_skills(&coalesced, &cache, &[root.to_path_buf()]);
        assert!(affected.to_rescan.is_empty());
        assert!(affected.to_delete.is_empty());
    }

    // ─── batch_upsert_cache_entries ───

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
            installed_at: 100,
            updated_at: 200,
        }]);

        let new_entry = SkillCacheEntry {
            id: "ssot:old".to_string(),
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
            installed_at: 0,
            updated_at: 300,
        };

        let remove_ids = HashSet::new();
        cache.write().unwrap().apply_batch_upsert(vec![new_entry], &remove_ids);

        let c = cache.read().unwrap();
        let entry = c.skills.iter().find(|s| s.id == "ssot:old").unwrap();
        assert_eq!(entry.installed_at, 100);
        assert_eq!(entry.updated_at, 300);
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

        cache.write().unwrap().apply_batch_upsert(vec![], &remove_ids);

        let c = cache.read().unwrap();
        assert_eq!(c.skills.len(), 1);
        assert_eq!(c.skills[0].id, "ssot:keep");
    }

    #[test]
    fn batch_upsert_adds_new_entry() {
        let cache = make_cache(vec![make_entry("ssot:existing", "existing", "/fake/existing")]);

        let new_entry = make_entry("ssot:new", "new", "/fake/new");
        let remove_ids = HashSet::new();

        cache.write().unwrap().apply_batch_upsert(vec![new_entry], &remove_ids);

        let c = cache.read().unwrap();
        assert_eq!(c.skills.len(), 2);
        assert!(c.skills.iter().any(|s| s.id == "ssot:new"));
    }

    #[test]
    fn batch_upsert_skips_stale_entries() {
        let mut cached = make_entry("ssot:skill", "skill", "/fake/skill");
        cached.updated_at = 200;

        let cache = make_cache(vec![cached]);

        let mut stale_entry = make_entry("ssot:skill", "skill", "/fake/skill");
        stale_entry.updated_at = 100;
        stale_entry.name = "stale-name".to_string();

        let remove_ids = HashSet::new();
        cache.write().unwrap().apply_batch_upsert(vec![stale_entry], &remove_ids);

        let c = cache.read().unwrap();
        let entry = c.skills.iter().find(|s| s.id == "ssot:skill").unwrap();
        assert_eq!(entry.updated_at, 200);
        assert_ne!(entry.name, "stale-name");
    }

    #[test]
    fn batch_upsert_allows_fresher_entries() {
        let mut cached = make_entry("ssot:skill", "skill", "/fake/skill");
        cached.updated_at = 100;
        cached.name = "old-name".to_string();

        let cache = make_cache(vec![cached]);

        let mut fresh_entry = make_entry("ssot:skill", "skill", "/fake/skill");
        fresh_entry.updated_at = 200;
        fresh_entry.name = "fresh-name".to_string();

        let remove_ids = HashSet::new();
        cache.write().unwrap().apply_batch_upsert(vec![fresh_entry], &remove_ids);

        let c = cache.read().unwrap();
        let entry = c.skills.iter().find(|s| s.id == "ssot:skill").unwrap();
        assert_eq!(entry.updated_at, 200);
        assert_eq!(entry.name, "fresh-name");
    }
}
