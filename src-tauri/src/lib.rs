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
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Start with empty skill cache so the first get_installed_skills
            // triggers a filesystem rebuild, keeping cache in sync with reality.
            let skill_cache = persistence::SkillCache { skills: Vec::new() };
            let metadata = persistence::MetadataStore::load().unwrap_or_else(|_| {
                persistence::MetadataStore { entries: std::collections::HashMap::new() }
            });
            let settings = persistence::Settings::load().unwrap_or_else(|_| {
                persistence::Settings { values: std::collections::HashMap::new() }
            });

            let app_state = AppState::new(skill_cache, metadata, settings);
            app.manage(app_state);

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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::skill::install_skills,
            commands::skill::get_installed_skills,
            commands::skill::update_skill,
            commands::skill::update_all_skills,
            commands::skill::remove_skill,
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
            commands::skill::get_repo_skills,
            commands::skill::preview_skill_md,
            commands::skill::search_skills_sh,
            commands::skill::star_skill,
            commands::skill::unstar_skill,
            commands::skill::set_skill_is_mine,
            commands::skill::create_skill,
            commands::skill::list_skill_files,
            commands::settings::get_settings,
            commands::settings::update_setting,
            commands::settings::set_window_theme,
            commands::settings::get_visible_agents,
            commands::settings::update_visible_agents,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
