#[cfg(feature = "test-helpers")]
pub mod commands;
#[cfg(feature = "test-helpers")]
pub mod config;
#[cfg(feature = "test-helpers")]
pub mod error;
#[cfg(feature = "test-helpers")]
pub mod persistence;
#[cfg(feature = "test-helpers")]
pub mod services;
#[cfg(feature = "test-helpers")]
pub mod store;

#[cfg(not(feature = "test-helpers"))]
mod commands;
#[cfg(not(feature = "test-helpers"))]
mod config;
#[cfg(not(feature = "test-helpers"))]
mod error;
#[cfg(not(feature = "test-helpers"))]
mod persistence;
#[cfg(not(feature = "test-helpers"))]
mod services;
#[cfg(not(feature = "test-helpers"))]
mod store;

use store::AppState;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Clean up residual .tmp files from interrupted downloads
            let cache_dir = config::get_repo_zip_cache_dir();
            if cache_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(&cache_dir) {
                    for entry in entries.flatten() {
                        if let Some(name) = entry.file_name().to_str() {
                            if name.ends_with(".zip.tmp") {
                                let _ = std::fs::remove_file(entry.path());
                            }
                        }
                    }
                }
            }

            // Load the persisted derived cache so the UI can render immediately,
            // then reconcile with filesystem truth in the background.
            let skill_cache = persistence::SkillCache::load()
                .unwrap_or_else(|_| persistence::SkillCache::empty());
            let should_reconcile_cache = !skill_cache.is_empty();
            let metadata =
                persistence::MetadataStore::load().unwrap_or_else(|_| persistence::MetadataStore {
                    entries: std::collections::HashMap::new(),
                });
            let settings =
                persistence::Settings::load().unwrap_or_else(|_| persistence::Settings {
                    values: std::collections::HashMap::new(),
                });

            let app_state = AppState::new(skill_cache, metadata, settings);
            app.manage(app_state);

            if let Err(e) = services::tray::setup_tray(app) {
                eprintln!("Failed to set up system tray: {e}");
            }

            if should_reconcile_cache {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<AppState>();
                    match services::skill::SkillService::rebuild_cache(
                        &state.skill_cache,
                        &state.metadata,
                        &state.sync_in_progress,
                    )
                    .await
                    {
                        Ok(_) => {
                            let _ = app_handle.emit("skills-changed", ());
                        }
                        Err(e) => eprintln!("Failed to reconcile skill cache on startup: {e}"),
                    }
                });
            }

            // Start filesystem watcher for auto-refresh on external changes
            let app_handle = app.handle().clone();
            let state = app.state::<AppState>();
            match services::watcher::start_skill_watcher(app_handle) {
                Ok((watcher, task)) => {
                    state.fs_watcher.lock().unwrap().replace(watcher);
                    state.watcher_task.lock().unwrap().replace(task);
                }
                Err(e) => eprintln!("Failed to start file watcher: {e}"),
            }

            // Register updater plugin (skipped for portable builds)
            #[cfg(all(desktop, not(feature = "portable")))]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())
                .expect("Failed to register updater plugin");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::skill::install_skills,
            commands::skill::get_installed_skills,
            commands::skill::update_skill,
            commands::skill::update_all_skills,
            commands::skill::get_skill_update_history,
            commands::skill::delete_skill_update_history_record,
            commands::skill::clear_skill_update_history,
            commands::skill::remove_skill,
            commands::skill::remove_skills,
            commands::skill::archive_skill,
            commands::skill::archive_skills,
            commands::skill::restore_archived_skill,
            commands::skill::restore_archived_skills,
            commands::skill::get_archived_skills,
            commands::skill::read_archived_skill_md,
            commands::skill::read_skill_md,
            commands::skill::write_skill_md,
            commands::skill::get_symlink_status,
            commands::skill::toggle_symlink,
            commands::skill::merge_duplicates_to_ssot,
            commands::skill::open_skills_dir,
            commands::skill::open_skill_dir,
            commands::skill::open_skill_path,
            commands::skill::get_agent_paths,
            commands::skill::get_agent_configs,
            commands::skill::get_banners,
            commands::skill::get_recommended_repos,
            commands::skill::search_repo,
            commands::skill::get_repo_metadata,
            commands::skill::get_repo_readme,
            commands::skill::get_repo_skills,
            commands::skill::preview_skill_md,
            commands::skill::search_skills_sh,
            commands::skill::get_skill_audit,
            commands::skill::star_skill,
            commands::skill::unstar_skill,
            commands::skill::set_skill_is_mine,
            commands::skill::create_skill,
            commands::skill::list_skill_files,
            commands::skill::list_skill_file_children,
            commands::skill::read_skill_file_path,
            commands::skill::read_skill_image_path,
            commands::skill::write_skill_file_path,
            commands::settings::get_settings,
            commands::settings::update_setting,
            commands::settings::get_skill_companion_items,
            commands::settings::save_skill_companion_items,
            commands::settings::set_tray_language,
            commands::settings::get_claude_skill_usage,
            commands::settings::set_window_theme,
            commands::settings::get_visible_agents,
            commands::settings::update_visible_agents,
            commands::settings::update_agent_preferences,
            commands::settings::clear_download_cache,
            commands::settings::get_cache_size,
            commands::settings::open_cache_dir,
            commands::settings::check_skill_updates,
            commands::settings::is_portable_build,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
