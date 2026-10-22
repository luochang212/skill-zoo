use crate::config;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const SUPPORTED_LOCK_VERSION: i32 = 3;

/// Recursion cap for baseline hashing, mirroring the install copy depth cap.
const MAX_HASH_DEPTH: usize = 20;

/// Process-wide mutex serializing all lock-file read-modify-write so concurrent
/// `SkillLock::update` calls don't lose fields to interleaved writes.
static LOCK_WRITE: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillLockEntry {
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
    pub source: Option<String>,
    #[serde(default, rename = "sourceType")]
    pub source_type: Option<String>,
    #[serde(default, rename = "sourceUrl")]
    pub source_url: Option<String>,
    #[serde(default, rename = "ref")]
    pub branch: Option<String>,
    #[serde(default, rename = "skillPath")]
    pub skill_path: Option<String>,
    #[serde(default, rename = "skillFolderHash")]
    pub skill_folder_hash: Option<String>,
    #[serde(default, rename = "installedAt")]
    pub installed_at: Option<String>,
    #[serde(default, rename = "updatedAt")]
    pub updated_at: Option<String>,
    #[serde(default, rename = "commitSha")]
    pub commit_sha: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillLock {
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
    #[serde(default = "default_version")]
    pub version: i32,
    #[serde(default)]
    pub skills: BTreeMap<String, SkillLockEntry>,
    #[serde(default)]
    pub dismissed: serde_json::Value,
}

fn default_version() -> i32 {
    SUPPORTED_LOCK_VERSION
}

impl SkillLock {
    /// Atomically read-modify-write the lock file under an exclusive guard.
    ///
    /// Runs under a process-wide mutex, so concurrent callers serialize. The
    /// closure must be pure memory mutation — no await, no IO, no reentrant
    /// `read`/`write`/`update` (the mutex is non-reentrant).
    pub fn update<F, R>(f: F) -> Result<R, AppError>
    where
        F: FnOnce(&mut SkillLock) -> Result<R, AppError>,
    {
        let _guard = LOCK_WRITE.lock().map_err(|e| {
            AppError::Io(std::io::Error::other(format!("lock mutex poisoned: {e}")))
        })?;
        let mut lock = Self::read()?;
        let result = f(&mut lock)?;
        lock.write()?;
        Ok(result)
    }

    pub fn read() -> Result<Self, AppError> {
        let path = config::get_agent_lock_file();
        if !path.exists() {
            return Ok(Self {
                extra: BTreeMap::new(),
                version: SUPPORTED_LOCK_VERSION,
                skills: BTreeMap::new(),
                dismissed: serde_json::Value::Object(Default::default()),
            });
        }
        let content = std::fs::read_to_string(&path).map_err(|e| {
            AppError::Io(std::io::Error::other(format!(
                "Failed to read lock file {}: {e}",
                path.display()
            )))
        })?;
        serde_json::from_str(&content).map_err(|e| AppError::Parse(e.to_string()))
    }

    pub fn write(&self) -> Result<(), AppError> {
        self.write_to(&config::get_agent_lock_file())
    }

    pub fn write_to(&self, path: &Path) -> Result<(), AppError> {
        if self.version > SUPPORTED_LOCK_VERSION {
            return Err(AppError::BadRequest(format!(
                "Lock file version {} is newer than this desktop app supports. Upgrade Skill Zoo before writing.",
                self.version
            )));
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(AppError::Io)?;
        }
        let content =
            serde_json::to_string_pretty(self).map_err(|e| AppError::Parse(e.to_string()))?;
        crate::persistence::atomic_write(path, &content).map_err(AppError::Io)?;
        Ok(())
    }
}

impl SkillLock {
    pub fn update_commit_sha(skill_name: &str, sha: &str) -> Result<(), AppError> {
        Self::update(|lock| {
            if let Some(entry) = lock.skills.get_mut(skill_name) {
                entry.commit_sha = Some(sha.to_string());
            }
            Ok(())
        })
    }
}

impl SkillLockEntry {
    /// Parse owner/name from the "source" field (e.g. "anthropics/skills").
    pub fn parse_source_owner_name(&self) -> (Option<String>, Option<String>) {
        let src = match &self.source {
            Some(s) => s.as_str(),
            None => return (None, None),
        };
        let parts: Vec<&str> = src.split('/').collect();
        (
            parts.first().map(|s| s.to_string()),
            parts.get(1).map(|s| s.to_string()),
        )
    }

    /// The stored content baseline, or `None` when it is unknown: missing,
    /// empty, or a legacy value (older writers stored 40-char git SHAs) that
    /// this app's SHA-256 algorithm could not have produced.
    pub fn content_baseline(&self) -> Option<&str> {
        match self.skill_folder_hash.as_deref() {
            Some(hash)
                if hash.len() == 64
                    && hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) =>
            {
                Some(hash)
            }
            _ => None,
        }
    }

    /// Get source_url if present; derive from source field as fallback.
    pub fn effective_url(&self) -> Option<String> {
        if let Some(url) = &self.source_url {
            if !url.is_empty() {
                return Some(url.clone());
            }
        }
        if let Some(src) = &self.source {
            if src.contains('/') && self.source_type.as_deref().unwrap_or("github") == "github" {
                return Some(format!("https://github.com/{src}"));
            }
        }
        None
    }

    /// Extract (owner, repo_name, source_url) from this lock entry.
    pub fn to_repo_info(&self) -> (Option<String>, Option<String>, Option<String>) {
        let (owner, name) = self.parse_source_owner_name();
        let url = self.effective_url();
        (owner, name, url)
    }
}

/// Deterministic content baseline over an installed skill folder, as documented
/// in `docs/local-protocol.md`: SHA-256 over `relative-path + 0x00 + bytes` for
/// every regular file, ordered by relative path. Symbolic links are skipped,
/// never followed, so only real content moves the baseline.
pub fn compute_skill_folder_hash(dir: &Path) -> Result<String, AppError> {
    use sha2::Digest;

    let mut files = Vec::new();
    collect_regular_files(dir, dir, 0, &mut files)?;
    files.sort_by(|a, b| {
        a.0.as_os_str()
            .as_encoded_bytes()
            .cmp(b.0.as_os_str().as_encoded_bytes())
    });
    let mut hasher = sha2::Sha256::new();
    for (rel, abs) in files {
        hasher.update(rel.as_os_str().as_encoded_bytes());
        hasher.update([0u8]);
        let mut file = std::fs::File::open(&abs).map_err(AppError::Io)?;
        let mut buf = [0u8; 8192];
        loop {
            let read = file.read(&mut buf).map_err(AppError::Io)?;
            if read == 0 {
                break;
            }
            hasher.update(&buf[..read]);
        }
    }
    let digest = hasher.finalize();
    Ok(digest.iter().map(|b| format!("{:02x}", b)).collect())
}

/// Whether the folder's current content differs from the entry's stored
/// baseline. Unknown baselines and unreadable folders judge as "not drifted":
/// drift must never be claimed without evidence.
pub fn skill_folder_drifted(dir: &Path, entry: &SkillLockEntry) -> bool {
    let Some(baseline) = entry.content_baseline() else {
        return false;
    };
    match compute_skill_folder_hash(dir) {
        Ok(current) => current != baseline,
        Err(_) => false,
    }
}

fn collect_regular_files(
    root: &Path,
    dir: &Path,
    depth: usize,
    out: &mut Vec<(PathBuf, PathBuf)>,
) -> Result<(), AppError> {
    if depth > MAX_HASH_DEPTH {
        return Err(AppError::BadRequest(format!(
            "Skill folder nesting exceeds the maximum depth of {MAX_HASH_DEPTH}: {}",
            dir.display()
        )));
    }
    for entry in std::fs::read_dir(dir).map_err(AppError::Io)? {
        let entry = entry.map_err(AppError::Io)?;
        let file_type = entry.file_type().map_err(AppError::Io)?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            collect_regular_files(root, &path, depth + 1, out)?;
        } else if file_type.is_file() {
            let rel = path.strip_prefix(root).unwrap_or(&path).to_path_buf();
            out.push((rel, path));
        }
    }
    Ok(())
}
