mod common;
use common::*;
use skill_zoo_lib::config;
use skill_zoo_lib::persistence::metadata::SkillMetadata;
use skill_zoo_lib::persistence::{MetadataStore, Settings};
use skill_zoo_lib::store::AppState;
use std::{collections::HashMap, sync::RwLock};

#[test]
fn test_lock_roundtrip_preserves_unknown_fields() {
    let lock: SkillLock = serde_json::from_value(serde_json::json!({"version":3,"skills":{"demo":{"source":"owner/repo","futureOptional":"keep-me"}},"dismissed":{},"futureTop":"keep-me"})).unwrap();
    let output = serde_json::to_value(lock).unwrap();
    assert_eq!(output["futureTop"], "keep-me");
    assert_eq!(output["skills"]["demo"]["futureOptional"], "keep-me");
}

#[test]
fn test_merge_existing_ssot_preserves_metadata() {
    let tmp = tempfile::tempdir().unwrap();
    config::with_test_home(tmp.path(), || {
        let ssot = config::get_agents_skills_dir().join("demo");
        let native = config::get_agent_skills_dir("codex").unwrap().join("demo");
        for path in [&ssot, &native] {
            std::fs::create_dir_all(path).unwrap();
            std::fs::write(path.join("SKILL.md"), "# demo").unwrap();
        }
        let mut a = make_cache_entry("ssot:demo", "demo", "demo");
        a.home_path = Some(ssot.to_string_lossy().into_owned());
        a.content_hash = Some("same".into());
        let mut b = a.clone();
        b.id = "agent:codex:demo".into();
        b.origin = "agent".into();
        b.home_agent = Some("codex".into());
        b.home_path = Some(native.to_string_lossy().into_owned());
        let cache = RwLock::new(SkillCache::from_entries(vec![a, b]));
        let metadata = RwLock::new(MetadataStore {
            entries: HashMap::from([(
                "ssot:demo".into(),
                SkillMetadata {
                    starred: true,
                    is_mine: true,
                },
            )]),
        });
        SkillService::merge_duplicates_to_ssot("demo", &cache, &metadata).unwrap();
        assert!(metadata.read().unwrap().get("ssot:demo").starred);
        assert!(metadata.read().unwrap().get("ssot:demo").is_mine);
    });
}

#[test]
fn test_merge_rejects_invalid_destination_without_deleting_originals() {
    let tmp = tempfile::tempdir().unwrap();
    config::with_test_home(tmp.path(), || {
        let ssot = config::get_agents_skills_dir().join("demo");
        std::fs::create_dir_all(&ssot).unwrap();
        std::fs::write(ssot.join("unrelated.txt"), "not a skill").unwrap();
        let mut entries = Vec::new();
        let mut original_paths = Vec::new();
        for agent in ["codex", "gemini"] {
            let native = config::get_agent_skills_dir(agent).unwrap().join("demo");
            std::fs::create_dir_all(&native).unwrap();
            std::fs::write(native.join("SKILL.md"), "# demo").unwrap();
            std::fs::write(native.join("valuable.txt"), "user data").unwrap();
            let mut e = make_cache_entry(&format!("agent:{agent}:demo"), "demo", "demo");
            e.origin = "agent".into();
            e.home_agent = Some(agent.into());
            e.home_path = Some(native.to_string_lossy().into_owned());
            e.content_hash = Some("same".into());
            entries.push(e);
            original_paths.push(native);
        }
        let cache = RwLock::new(SkillCache::from_entries(entries));
        let metadata = RwLock::new(MetadataStore {
            entries: HashMap::new(),
        });
        assert!(SkillService::merge_duplicates_to_ssot("demo", &cache, &metadata).is_err());
        for p in original_paths {
            assert!(p.join("valuable.txt").exists());
        }
        assert!(!ssot.join("valuable.txt").exists());
    });
}

#[test]
fn test_desktop_lease_write_preserves_metadata_committed_by_cli() {
    let tmp = tempfile::tempdir().unwrap();
    config::with_test_home(tmp.path(), || {
        MetadataStore {
            entries: HashMap::from([(
                "ssot:demo".to_string(),
                SkillMetadata {
                    starred: true,
                    is_mine: false,
                },
            )]),
        }
        .save()
        .unwrap();

        let state = AppState::new(
            skill_zoo_lib::persistence::SkillCache::empty(),
            MetadataStore {
                entries: HashMap::new(),
            },
            Settings {
                values: HashMap::new(),
            },
        );

        {
            let _lease = state.acquire_local_lease().unwrap();
            let mut metadata = state.metadata.write().unwrap();
            metadata.set_starred("ssot:other", true);
            metadata.save().unwrap();
        }

        let disk = MetadataStore::load().unwrap();
        assert!(
            disk.get("ssot:demo").starred,
            "CLI-committed star must survive a desktop write"
        );
        assert!(disk.get("ssot:other").starred);
    });
}

#[cfg(unix)]
#[test]
fn test_merge_rolls_back_partial_destination_for_symlinked_sources() {
    use std::os::unix::fs::symlink;

    let tmp = tempfile::tempdir().unwrap();
    config::with_test_home(tmp.path(), || {
        let mut entries = Vec::new();
        for agent in ["codex", "gemini"] {
            let native = config::get_agent_skills_dir(agent).unwrap().join("demo");
            std::fs::create_dir_all(&native).unwrap();
            std::fs::write(native.join("SKILL.md"), "# demo").unwrap();
            std::fs::write(native.join("real.txt"), "shared").unwrap();
            symlink("real.txt", native.join("alias.txt")).unwrap();
            let mut e = make_cache_entry(&format!("agent:{agent}:demo"), "demo", "demo");
            e.origin = "agent".into();
            e.home_agent = Some(agent.into());
            e.home_path = Some(native.to_string_lossy().into_owned());
            e.content_hash = Some("same".into());
            entries.push(e);
        }
        let cache = RwLock::new(SkillCache::from_entries(entries));
        let metadata = RwLock::new(MetadataStore {
            entries: HashMap::new(),
        });

        assert!(SkillService::merge_duplicates_to_ssot("demo", &cache, &metadata).is_err());
        assert!(
            !config::get_agents_skills_dir().join("demo").exists(),
            "failed verification must not leave a partial SSOT copy"
        );
        for agent in ["codex", "gemini"] {
            let native = config::get_agent_skills_dir(agent).unwrap().join("demo");
            assert!(native.join("SKILL.md").exists(), "originals must survive");
            assert!(native.join("alias.txt").exists(), "originals must survive");
        }
    });
}
