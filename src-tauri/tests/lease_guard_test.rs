#[cfg(unix)]
mod cross_process {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    use skill_zoo_lib::config;
    use skill_zoo_lib::persistence::{
        agent_transaction::AgentLease, MetadataStore, Settings, SkillCache,
    };
    use skill_zoo_lib::store::AppState;
    use tauri::Manager;

    #[test]
    fn write_skill_text_rejects_with_operation_in_progress_while_a_second_process_holds_the_lease()
    {
        let tmp = tempfile::tempdir().unwrap();
        let ready = tmp.path().join("lease-holder-ready");
        let mut holder = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "cross_process::lease_holder_parks_until_killed",
                "--ignored",
            ])
            .env("LEASE_HOLDER_HOME", tmp.path())
            .env("LEASE_HOLDER_READY", &ready)
            .env("HOME", tmp.path())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();

        let deadline = Instant::now() + Duration::from_secs(10);
        while !ready.exists() {
            assert!(
                Instant::now() < deadline,
                "lease holder process never signalled readiness"
            );
            assert!(
                holder.try_wait().unwrap().is_none(),
                "lease holder process exited before signalling readiness"
            );
            std::thread::sleep(Duration::from_millis(20));
        }

        let rejection = config::with_test_home(tmp.path(), || {
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
            let state = app.state::<AppState>();
            skill_zoo_lib::commands::skill::write_skill_text(
                state,
                "agent:codex:demo".into(),
                "SKILL.md".into(),
                "# demo".into(),
            )
        });
        let error: serde_json::Value = serde_json::to_value(rejection.unwrap_err()).unwrap();
        assert_eq!(error["code"], "operationInProgress");

        holder.kill().unwrap();
        holder.wait().unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        let reacquired = loop {
            let ok = config::with_test_home(tmp.path(), || {
                AgentLease::acquire(&config::get_app_config_dir()).is_ok()
            });
            if ok || Instant::now() >= deadline {
                break ok;
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        assert!(
            reacquired,
            "lease must be re-acquirable after the holder dies"
        );
    }

    #[test]
    #[ignore]
    fn lease_holder_parks_until_killed() {
        let home = std::path::PathBuf::from(std::env::var("LEASE_HOLDER_HOME").unwrap());
        let ready = std::env::var("LEASE_HOLDER_READY").unwrap();
        config::with_test_home(&home, || {
            let _lease = AgentLease::acquire(&config::get_app_config_dir()).unwrap();
            std::fs::write(&ready, b"holding").unwrap();
            std::thread::sleep(Duration::from_secs(30));
        });
    }
}
