mod common;
use common::*;
use skill_zoo_lib::config;
use std::sync::RwLock;
#[cfg(unix)]
#[test]
fn merge_rejects_directory_links_without_removing_originals() {
    let tmp = tempfile::tempdir().unwrap();
    config::with_test_home(tmp.path(), || {
        let shared = tmp.path().join("shared-assets");
        std::fs::create_dir_all(&shared).unwrap();
        std::fs::write(shared.join("asset.txt"), "required asset").unwrap();
        let mut entries = Vec::new();
        for agent in ["codex", "gemini"] {
            let native = config::get_agent_skills_dir(agent).unwrap().join("demo");
            std::fs::create_dir_all(&native).unwrap();
            std::fs::write(native.join("SKILL.md"), "# Demo\nUse assets/asset.txt").unwrap();
            std::os::unix::fs::symlink(&shared, native.join("assets")).unwrap();
            let mut e = make_cache_entry(&format!("agent:{agent}:demo"), "demo", "demo");
            e.origin = "agent".into();
            e.home_agent = Some(agent.into());
            e.home_path = Some(native.to_string_lossy().into_owned());
            e.content_hash = Some("same".into());
            entries.push(e);
        }
        let cache = RwLock::new(SkillCache::from_entries(entries));
        let metadata = RwLock::new(MetadataStore {
            entries: Default::default(),
        });
        let result = SkillService::merge_duplicates_to_ssot("demo", &cache, &metadata);
        let dest = config::get_agents_skills_dir().join("demo");
        assert!(result.is_err());
        for agent in ["codex", "gemini"] {
            let native = config::get_agent_skills_dir(agent).unwrap().join("demo");
            assert!(native.join("assets").is_symlink());
            assert_eq!(
                std::fs::read_to_string(native.join("assets/asset.txt")).unwrap(),
                "required asset"
            );
        }
        assert_eq!(
            std::fs::read_to_string(shared.join("asset.txt")).unwrap(),
            "required asset"
        );
        assert!(!dest.join("assets").exists());
    });
}
#[test]
fn refresh_observes_write_that_completed_while_it_waited_for_metadata_lock() {
    use std::sync::Arc;
    let tmp = tempfile::tempdir().unwrap();
    config::with_test_home(tmp.path(), || {
        let cache = Arc::new(RwLock::new(SkillCache::empty()));
        let metadata = Arc::new(RwLock::new(MetadataStore {
            entries: Default::default(),
        }));
        metadata.read().unwrap().save().unwrap();
        let state_lease = skill_zoo_lib::persistence::agent_transaction::AgentLease::acquire(
            &config::get_app_config_dir(),
        )
        .unwrap();
        let mut writing = metadata.write().unwrap();
        let cache2 = Arc::clone(&cache);
        let metadata2 = Arc::clone(&metadata);
        let home = tmp.path().to_path_buf();
        let t = std::thread::spawn(move || {
            config::with_test_home(&home, || {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap();
                rt.block_on(SkillService::refresh_installed_skills(
                    &cache2,
                    &metadata2,
                    &tokio::sync::Mutex::new(()),
                    Vec::new(),
                ))
                .unwrap();
            })
        });
        let cache_file = config::get_app_config_dir().join("skills-cache.json");
        for _ in 0..200 {
            if cache_file.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(cache_file.exists());
        std::thread::sleep(std::time::Duration::from_millis(500));
        writing.set_starred("ssot:demo", true);
        writing.save().unwrap();
        drop(writing);
        t.join().unwrap();
        drop(state_lease);
        assert!(MetadataStore::load().unwrap().get("ssot:demo").starred);
        assert!(metadata.read().unwrap().get("ssot:demo").starred);
    });
}
