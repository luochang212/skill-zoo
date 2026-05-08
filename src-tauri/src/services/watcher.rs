use crate::config;
use crate::services::skill::SkillService;
use crate::store::AppState;
use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;

const DEBOUNCE_MS: u64 = 1500;

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
        // Wait for the first event
        if rx.recv().await.is_none() {
            break;
        }

        // Debounce: reset timer on each subsequent event
        let timer = tokio::time::sleep(Duration::from_millis(DEBOUNCE_MS));
        tokio::pin!(timer);
        loop {
            tokio::select! {
                maybe_event = rx.recv() => {
                    if maybe_event.is_none() {
                        return;
                    }
                    timer.as_mut().reset(
                        tokio::time::Instant::now() + Duration::from_millis(DEBOUNCE_MS),
                    );
                }
                _ = &mut timer => {
                    break;
                }
            }
        }

        trigger_rebuild(&app_handle).await;
    }
}

async fn trigger_rebuild(app_handle: &tauri::AppHandle) {
    let state = app_handle.state::<AppState>();
    match SkillService::rebuild_cache(&state.skill_cache, &state.metadata, &state.sync_in_progress)
        .await
    {
        Ok(_) => {
            let _ = app_handle.emit("skills-changed", ());
        }
        Err(e) => {
            eprintln!("Watcher rebuild failed: {e}");
        }
    }
}
