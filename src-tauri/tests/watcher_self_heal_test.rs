use skill_zoo_lib::config;
use skill_zoo_lib::persistence::{MetadataStore, Settings, SkillCache};
use skill_zoo_lib::store::AppState;
use tauri::Manager;

#[test]
fn get_installed_skills_restarts_the_dead_watcher_once_directories_appear() {
    let tmp = tempfile::tempdir().unwrap();
    std::env::set_var("HOME", tmp.path());
    config::with_test_home(tmp.path(), || {
        let app = tauri::test::mock_app();
        app.manage(AppState::new(
            SkillCache::empty(),
            MetadataStore {
                entries: Default::default(),
            },
            Settings {
                values: Default::default(),
            },
        ));
        let handle = app.handle().clone();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();

        let skills = rt
            .block_on(skill_zoo_lib::commands::skill::get_installed_skills(
                handle.clone(),
                app.state::<AppState>(),
                None,
            ))
            .unwrap();
        assert!(skills.is_empty());
        assert!(
            app.state::<AppState>().fs_watcher.lock().unwrap().is_none(),
            "no watch roots exist yet, the watcher must stay dead"
        );

        let ssot = config::get_agents_skills_dir().join("demo");
        std::fs::create_dir_all(&ssot).unwrap();
        std::fs::write(ssot.join("SKILL.md"), "# demo").unwrap();

        let skills = rt
            .block_on(skill_zoo_lib::commands::skill::get_installed_skills(
                handle.clone(),
                app.state::<AppState>(),
                None,
            ))
            .unwrap();
        assert_eq!(skills.len(), 1);
        assert!(
            app.state::<AppState>().fs_watcher.lock().unwrap().is_some(),
            "the empty-cache rebuild path must restart the dead watcher"
        );
    });
}
