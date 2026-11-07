mod common;
use common::*;
use skill_zoo_lib::{
    config,
    persistence::metadata::SkillMetadata,
    persistence::{MetadataStore, SkillCache},
};
use std::{collections::HashMap, sync::RwLock};

#[test]
fn merge_save_failures_preserve_originals_links_and_user_flags() {
    for store in ["skills-cache.json", "metadata.json"] {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let mut entries = Vec::new();
            let mut homes = Vec::new();
            for agent in ["codex", "gemini"] {
                let home = config::get_agent_skills_dir(agent).unwrap().join("demo");
                std::fs::create_dir_all(&home).unwrap();
                std::fs::write(home.join("SKILL.md"), "# demo").unwrap();
                let mut entry = make_cache_entry(&format!("agent:{agent}:demo"), "demo", "demo");
                entry.origin = "agent".into();
                entry.home_agent = Some(agent.into());
                entry.home_path = Some(home.to_string_lossy().into_owned());
                entry.content_hash = Some("same".into());
                entries.push(entry);
                homes.push(home);
            }
            let claude = config::get_agent_skills_dir("claude-code").unwrap();
            std::fs::create_dir_all(&claude).unwrap();
            SkillService::toggle_symlink("demo", &homes[0].to_string_lossy(), "claude-code", true)
                .unwrap();
            let cache = RwLock::new(SkillCache::from_entries(entries));
            let metadata = RwLock::new(MetadataStore {
                entries: HashMap::from([(
                    "agent:codex:demo".into(),
                    SkillMetadata {
                        starred: true,
                        is_mine: true,
                    },
                )]),
            });
            cache.read().unwrap().save().unwrap();
            metadata.read().unwrap().save().unwrap();
            std::fs::create_dir_all(
                config::get_app_config_dir()
                    .join(store)
                    .with_extension("json.tmp"),
            )
            .unwrap();
            let error = SkillService::merge_duplicates_to_ssot("demo", &cache, &metadata)
                .unwrap_err()
                .to_string();
            assert!(error.contains("Recovery incomplete"), "{error}");
            for home in &homes {
                assert!(
                    !home.is_symlink(),
                    "{store}: original must remain a real directory"
                );
                assert_eq!(
                    std::fs::read_to_string(home.join("SKILL.md")).unwrap(),
                    "# demo"
                );
            }
            assert_eq!(
                std::fs::canonicalize(claude.join("demo")).unwrap(),
                homes[0].canonicalize().unwrap()
            );
            assert!(!config::get_agents_skills_dir().join("demo").exists());
            assert_eq!(cache.read().unwrap().skills().len(), 2);
            assert!(metadata.read().unwrap().get("agent:codex:demo").starred);
            assert!(
                MetadataStore::load()
                    .unwrap()
                    .get("agent:codex:demo")
                    .starred
            );
        });
    }
}

#[test]
fn merge_keeps_other_owners_and_retargets_existing_agent_links() {
    let tmp = tempfile::tempdir().unwrap();
    config::with_test_home(tmp.path(), || {
        let native = config::get_agent_skills_dir("codex").unwrap().join("demo");
        let ssot = config::get_agents_skills_dir().join("demo");
        let external = tmp.path().join("private/demo");
        let mut entries = Vec::new();
        for (id, origin, home) in [
            ("agent:codex:demo", "agent", &native),
            ("ssot:demo", "ssot", &ssot),
            ("external:demo", "external", &external),
            ("plugin:demo", "plugin", &external),
        ] {
            std::fs::create_dir_all(home).unwrap();
            std::fs::write(home.join("SKILL.md"), "# demo").unwrap();
            let mut entry = make_cache_entry(id, "demo", "demo");
            entry.origin = origin.into();
            entry.home_agent = (origin == "agent").then(|| "codex".into());
            entry.home_path = Some(home.to_string_lossy().into_owned());
            entry.content_hash = Some("same".into());
            entries.push(entry);
        }
        let claude = config::get_agent_skills_dir("claude-code").unwrap();
        std::fs::create_dir_all(&claude).unwrap();
        SkillService::toggle_symlink("demo", &native.to_string_lossy(), "claude-code", true)
            .unwrap();
        let cache = RwLock::new(SkillCache::from_entries(entries));
        let metadata = RwLock::new(MetadataStore {
            entries: HashMap::from([
                (
                    "agent:codex:demo".into(),
                    SkillMetadata {
                        starred: true,
                        is_mine: false,
                    },
                ),
                (
                    "external:demo".into(),
                    SkillMetadata {
                        starred: false,
                        is_mine: true,
                    },
                ),
            ]),
        });
        SkillService::merge_duplicates_to_ssot("demo", &cache, &metadata).unwrap();
        assert_eq!(native.canonicalize().unwrap(), ssot.canonicalize().unwrap());
        assert_eq!(
            claude.join("demo").canonicalize().unwrap(),
            ssot.canonicalize().unwrap()
        );
        assert_eq!(cache.read().unwrap().skills().len(), 3);
        assert!(cache.read().unwrap().find_by_id("external:demo").is_some());
        assert!(cache.read().unwrap().find_by_id("plugin:demo").is_some());
        assert!(metadata.read().unwrap().get("ssot:demo").starred);
        assert!(metadata.read().unwrap().get("external:demo").is_mine);
        assert!(external.join("SKILL.md").is_file());
    });
}

#[test]
fn merge_waits_for_refresh_and_releases_lease_when_cancelled() {
    use skill_zoo_lib::{
        persistence::{agent_transaction::AgentLease, Settings},
        store::AppState,
    };
    let tmp = tempfile::tempdir().unwrap();
    config::with_test_home(tmp.path(), || {
        let state = AppState::new(
            SkillCache::empty(),
            MetadataStore {
                entries: HashMap::new(),
            },
            Settings {
                values: HashMap::new(),
            },
        );
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(async {
                let refresh = state.cache_refresh_lock.lock().await;
                assert!(tokio::time::timeout(
                    std::time::Duration::from_millis(20),
                    SkillService::merge_duplicates(&state, "demo")
                )
                .await
                .is_err());
                let lease = AgentLease::acquire(&config::get_app_config_dir()).unwrap();
                drop(lease);
                drop(refresh);
                assert!(SkillService::merge_duplicates(&state, "demo")
                    .await
                    .is_err());
            });
    });
}

#[test]
fn merge_link_conflict_restores_nested_source_and_preserves_foreign_directory() {
    let tmp = tempfile::tempdir().unwrap();
    config::with_test_home(tmp.path(), || {
        let root = config::get_agent_skills_dir("codex").unwrap();
        let native = root.join(".system/demo");
        let foreign = root.join("demo");
        for path in [&native, &foreign] {
            std::fs::create_dir_all(path).unwrap();
        }
        std::fs::write(native.join("SKILL.md"), "# demo").unwrap();
        std::fs::write(foreign.join("keep.txt"), "private").unwrap();
        let mut entry = make_cache_entry("agent:codex:.system/demo", "demo", ".system/demo");
        entry.origin = "agent".into();
        entry.home_agent = Some("codex".into());
        entry.home_path = Some(native.to_string_lossy().into_owned());
        entry.content_hash = Some("same".into());
        let cache = RwLock::new(SkillCache::from_entries(vec![entry]));
        let metadata = RwLock::new(MetadataStore {
            entries: HashMap::new(),
        });
        assert!(SkillService::merge_duplicates_to_ssot("demo", &cache, &metadata).is_err());
        assert_eq!(
            std::fs::read_to_string(native.join("SKILL.md")).unwrap(),
            "# demo"
        );
        assert_eq!(
            std::fs::read_to_string(foreign.join("keep.txt")).unwrap(),
            "private"
        );
        assert!(!config::get_agents_skills_dir().join("demo").exists());
        assert!(cache
            .read()
            .unwrap()
            .find_by_id("agent:codex:.system/demo")
            .is_some());
    });
}

#[test]
fn merge_rejects_cached_agent_ownership_outside_its_real_root() {
    let tmp = tempfile::tempdir().unwrap();
    config::with_test_home(tmp.path(), || {
        let private = tmp.path().join("private/demo");
        std::fs::create_dir_all(&private).unwrap();
        std::fs::write(private.join("SKILL.md"), "# user source").unwrap();
        let mut entry = make_cache_entry("agent:codex:demo", "demo", "demo");
        entry.origin = "agent".into();
        entry.home_agent = Some("codex".into());
        entry.home_path = Some(private.to_string_lossy().into_owned());
        entry.content_hash = Some("same".into());
        let cache = RwLock::new(SkillCache::from_entries(vec![entry]));
        let metadata = RwLock::new(MetadataStore {
            entries: HashMap::new(),
        });
        assert!(SkillService::merge_duplicates_to_ssot("demo", &cache, &metadata).is_err());
        assert_eq!(
            std::fs::read_to_string(private.join("SKILL.md")).unwrap(),
            "# user source"
        );
        assert!(!config::get_agents_skills_dir().join("demo").exists());
    });
}
