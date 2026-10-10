use crate::error::{self, AppError};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

const FILES: &[&str] = &[
    "agents.json",
    "imports.json",
    "settings.json",
    "metadata.json",
];

// Loopback ownership is released by the OS even after a crash. Unlike PID-file
// reclamation, it cannot displace a newly acquired lease during stale recovery.
pub struct AgentLease {
    _listener: std::net::TcpListener,
}

impl AgentLease {
    pub fn acquire(dir: &Path) -> Result<Self, AppError> {
        use sha2::{Digest, Sha256};
        std::fs::create_dir_all(dir).map_err(|e| error::io(dir, e))?;
        let identity = dir.canonicalize().map_err(|e| error::io(dir, e))?;
        #[cfg(unix)]
        let identity = {
            use std::os::unix::fs::MetadataExt;
            let metadata = std::fs::metadata(&identity).map_err(|e| error::io(dir, e))?;
            format!("unix:{}:{}", metadata.dev(), metadata.ino())
        };
        #[cfg(windows)]
        let identity = super::normalize_path_separators(&identity.to_string_lossy());
        #[cfg(windows)]
        let identity = identity
            .strip_prefix("//?/")
            .unwrap_or(&identity)
            .to_lowercase();
        let hash = Sha256::digest(identity.as_bytes());
        let port = 10240 + (u16::from_be_bytes([hash[0], hash[1]]) % 16384);
        // SO_REUSEADDR keeps a fast release-and-reacquire (desktop restart, or
        // the release test) immune to kernel linger state on the closed
        // listener. A live listener elsewhere still fails the bind, so the
        // cross-process exclusivity contract is unchanged.
        #[cfg(unix)]
        let listener = {
            use socket2::{Domain, Protocol, Socket, Type};
            let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))
                .map_err(|e| error::io(dir, e))?;
            socket
                .set_reuse_address(true)
                .map_err(|e| error::io(dir, e))?;
            socket
                .bind(&std::net::SocketAddr::from((
                    std::net::Ipv4Addr::LOCALHOST,
                    port,
                ))
                .into())
                .map_err(|_| {
                    AppError::BadRequest("Another agent operation is running or the local lease is unavailable. Try again when it finishes.".into())
                })?;
            socket.listen(1).map_err(|e| error::io(dir, e))?;
            std::net::TcpListener::from(socket)
        };
        #[cfg(not(unix))]
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
            .map_err(|_| {
                AppError::BadRequest("Another agent operation is running or the local lease is unavailable. Try again when it finishes.".into())
            })?;
        let lease = Self {
            _listener: listener,
        };
        recover(dir)?;
        Ok(lease)
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Journal {
    version: u32,
    committed: bool,
    before: BTreeMap<String, Option<String>>,
    after: BTreeMap<String, Option<String>>,
}

fn write_snapshots(
    dir: &Path,
    snapshots: &BTreeMap<String, Option<String>>,
) -> Result<(), AppError> {
    for (name, content) in snapshots {
        if !FILES.contains(&name.as_str()) {
            return Err(AppError::BadRequest(
                "Invalid agent lifecycle journal filename".into(),
            ));
        }
        let path = dir.join(name);
        if let Some(bytes) = content {
            super::atomic_write(&path, bytes).map_err(|e| error::io(&path, e))?;
        } else if path.exists() {
            std::fs::remove_file(&path).map_err(|e| error::io(&path, e))?;
        }
    }
    Ok(())
}

pub fn recover(dir: &Path) -> Result<(), AppError> {
    let path = dir.join("agent-lifecycle.json");
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(error::io(&path, e)),
    };
    let journal: Journal =
        serde_json::from_slice(&bytes).map_err(|e| AppError::Parse(e.to_string()))?;
    if journal.version != 1 {
        return Err(AppError::BadRequest(
            "Upgrade Skill Zoo to recover this agent lifecycle".into(),
        ));
    }
    // Validate the entire journal before changing any file.
    if journal
        .before
        .keys()
        .chain(journal.after.keys())
        .any(|n| !FILES.contains(&n.as_str()))
    {
        return Err(AppError::BadRequest(
            "Invalid agent lifecycle journal filename".into(),
        ));
    }
    write_snapshots(
        dir,
        if journal.committed {
            &journal.after
        } else {
            &journal.before
        },
    )?;
    std::fs::remove_file(&path).map_err(|e| error::io(&path, e))
}

pub fn commit(dir: &Path, after: BTreeMap<String, Option<String>>) -> Result<(), AppError> {
    commit_with(dir, after, |_| Ok(()))
}

fn commit_with(
    dir: &Path,
    after: BTreeMap<String, Option<String>>,
    mut checkpoint: impl FnMut(usize) -> Result<(), AppError>,
) -> Result<(), AppError> {
    let mut before = BTreeMap::new();
    for name in after.keys() {
        if !FILES.contains(&name.as_str()) {
            return Err(AppError::BadRequest("Invalid lifecycle filename".into()));
        }
        let path = dir.join(name);
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => Some(c),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(error::io(&path, e)),
        };
        before.insert(name.clone(), content);
    }
    let mut journal = Journal {
        version: 1,
        committed: false,
        before,
        after,
    };
    let path = dir.join("agent-lifecycle.json");
    let save = |j: &Journal| -> Result<(), AppError> {
        let bytes = serde_json::to_vec_pretty(j).map_err(|e| AppError::Parse(e.to_string()))?;
        super::atomic_write(&path, bytes).map_err(|e| error::io(&path, e))
    };
    save(&journal)?;
    let result = (|| {
        checkpoint(0)?;
        for (i, (name, content)) in journal.after.iter().enumerate() {
            write_snapshots(dir, &BTreeMap::from([(name.clone(), content.clone())]))?;
            checkpoint(i + 1)?;
        }
        journal.committed = true;
        save(&journal)?;
        Ok(())
    })();
    if let Err(original) = result {
        recover(dir)?;
        return Err(original);
    }
    if checkpoint(journal.after.len() + 1).is_err() {
        // A durable commit is success even when post-commit cleanup is
        // interrupted. The next lease acquisition rolls the journal forward.
        return Ok(());
    }
    // The commit marker is durable. Cleanup failure must not report a rollback.
    if let Err(e) = recover(dir) {
        eprintln!("Committed agent lifecycle requires recovery: {e}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interrupted_postcommit_cleanup_rolls_forward() {
        let tmp = tempfile::tempdir().unwrap();
        let after = BTreeMap::from([("settings.json".into(), Some("new state".into()))]);
        commit_with(tmp.path(), after, |stage| {
            if stage == 2 {
                Err(AppError::BadRequest("interrupted cleanup".into()))
            } else {
                Ok(())
            }
        })
        .unwrap();
        assert!(tmp.path().join("agent-lifecycle.json").exists());
        std::fs::write(tmp.path().join("settings.json"), "partial state").unwrap();
        recover(tmp.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("settings.json")).unwrap(),
            "new state"
        );
    }

    #[test]
    fn replays_shared_crash_fixtures() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/local-protocol");
        for suffix in ["pending", "committed"] {
            let tmp = tempfile::tempdir().unwrap();
            let bytes =
                std::fs::read(fixtures.join(format!("agent-lifecycle-v1-{suffix}.json"))).unwrap();
            let journal: Journal = serde_json::from_slice(&bytes).unwrap();
            std::fs::write(tmp.path().join("agent-lifecycle.json"), bytes).unwrap();
            recover(tmp.path()).unwrap();
            let expected = if journal.committed {
                journal.after
            } else {
                journal.before
            };
            for (name, content) in expected {
                assert_eq!(std::fs::read_to_string(tmp.path().join(name)).ok(), content);
            }
        }
    }

    #[test]
    fn every_precommit_failure_restores_all_files() {
        for fail in 0..=3 {
            let tmp = tempfile::tempdir().unwrap();
            std::fs::write(tmp.path().join("settings.json"), "old").unwrap();
            let after = BTreeMap::from([
                ("settings.json".into(), Some("new".into())),
                ("agents.json".into(), Some("registry".into())),
                ("imports.json".into(), Some("references".into())),
            ]);
            assert!(commit_with(tmp.path(), after, |i| {
                if i == fail {
                    Err(AppError::BadRequest("injected".into()))
                } else {
                    Ok(())
                }
            })
            .is_err());
            assert_eq!(
                std::fs::read_to_string(tmp.path().join("settings.json")).unwrap(),
                "old"
            );
            assert!(!tmp.path().join("agents.json").exists());
            assert!(!tmp.path().join("imports.json").exists());
        }
    }

    #[test]
    fn live_lease_is_exclusive_and_released() {
        let tmp = tempfile::tempdir().unwrap();
        let lease = AgentLease::acquire(tmp.path()).unwrap();
        assert!(AgentLease::acquire(tmp.path()).is_err());
        drop(lease);
        assert!(AgentLease::acquire(tmp.path()).is_ok());
    }

    #[test]
    fn desktop_lease_excludes_the_real_cli_then_allows_it_after_release() {
        if std::process::Command::new("bun")
            .arg("--version")
            .output()
            .is_err()
        {
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let cli = Path::new(env!("CARGO_MANIFEST_DIR")).join("../packages/cli/src/index.ts");
        let invoke = || {
            std::process::Command::new("bun")
                .arg(&cli)
                .arg("--home")
                .arg(tmp.path())
                .args(["paths", "--json"])
                .output()
                .unwrap()
        };
        let lease = AgentLease::acquire(&tmp.path().join(".skill-zoo")).unwrap();
        let blocked = invoke();
        let response: serde_json::Value = serde_json::from_slice(&blocked.stdout).unwrap();
        assert_eq!(response["ok"], false);
        assert!(response["error"].as_str().unwrap().contains("operation"));
        drop(lease);
        let allowed = invoke();
        assert!(allowed.status.success());
        let response: serde_json::Value = serde_json::from_slice(&allowed.stdout).unwrap();
        assert_eq!(response["ok"], true);
    }
}
