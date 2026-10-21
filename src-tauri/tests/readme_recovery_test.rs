use skill_zoo_lib::{commands::skill::get_repo_readme, config, services::cli::CliService};
use std::{io::Write, process::Command};
use zip::write::SimpleFileOptions;

// Run the real command in a subprocess: reqwest caches its proxy configuration,
// so changing proxy environment variables inside a shared test process is unsafe.
#[test]
fn zip_readme_retries_after_credentials_change() {
    const CHILD: &str = "SKILL_ZOO_README_RECOVERY_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let mut proxy = mockito::Server::new();
        let attempts = proxy
            .mock("CONNECT", mockito::Matcher::Any)
            .with_status(502)
            .expect(2)
            .create();
        let mut child = Command::new(std::env::current_exe().unwrap());
        child.args([
            "--exact",
            "zip_readme_retries_after_credentials_change",
            "--nocapture",
        ]);
        child.env(CHILD, "1");
        for key in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
        ] {
            child.env(key, proxy.url());
        }
        child.env("NO_PROXY", "").env("no_proxy", "");
        let output = child.output().unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        println!("{}", String::from_utf8_lossy(&output.stdout));
        // One failed read before the credential change and one after it. The
        // fresh API cache control below must not make any further requests.
        attempts.assert();
        return;
    }

    let home = tempfile::tempdir().unwrap();
    config::with_test_home(home.path(), || {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            config::set_github_credentials(None, None);
            let zip_dir = config::get_repo_zip_cache_dir();
            std::fs::create_dir_all(&zip_dir).unwrap();
            let zip_path = zip_dir.join(CliService::cache_zip_file_name("owner", "repo", None));
            let mut archive = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
            archive
                .start_file("repo-main/README.md", SimpleFileOptions::default())
                .unwrap();
            archive.write_all(b"# Old ZIP README").unwrap();
            archive.finish().unwrap();

            let read = || get_repo_readme("owner".into(), "repo".into(), None, None);
            assert_eq!(read().await.unwrap(), "# Old ZIP README");
            // Disk README fallback should survive even if its ZIP is removed.
            std::fs::remove_file(&zip_path).unwrap();
            config::set_github_credentials(Some("test-token-not-a-real-credential"), None);
            assert_eq!(read().await.unwrap(), "# Old ZIP README");
            println!("ZIP fallback survives removal; credential change read completed");

            // A normal fresh API entry must retain its seven-day cache lifetime.
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            let cache = serde_json::json!({ "owner/repo/default": {
                "content": "# Fresh API README", "fetched_at": now,
            }});
            let cache_path = config::get_app_config_dir().join("repo-readme-cache.json");
            std::fs::write(&cache_path, serde_json::to_vec(&cache).unwrap()).unwrap();
            config::set_github_credentials(Some("replacement-test-token"), None);
            assert_eq!(read().await.unwrap(), "# Fresh API README");
            let saved: serde_json::Value =
                serde_json::from_slice(&std::fs::read(cache_path).unwrap()).unwrap();
            assert_eq!(saved, cache);
        });
    });
}
