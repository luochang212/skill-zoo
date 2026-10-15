use crate::config;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

pub const SUPPORTED_LOCK_VERSION: i32 = 3;

/// Process-wide mutex serializing all lock-file read-modify-write so concurrent
/// `SkillLock::update` calls don't lose fields to interleaved writes.
static LOCK_WRITE: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillLockEntry {
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
    #[serde(default, rename = "pinnedRef")]
    pub pinned_ref: Option<String>,
    /// Lock fields this app does not declare (externally introduced, e.g. by
    /// `npx skill` or `gh skill`). Preserved verbatim across our rewrites.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillLock {
    #[serde(default = "default_version")]
    pub version: i32,
    #[serde(default)]
    pub skills: BTreeMap<String, SkillLockEntry>,
    #[serde(default)]
    pub dismissed: serde_json::Value,
    /// Top-level lock fields this app does not declare. Preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl Default for SkillLock {
    fn default() -> Self {
        Self {
            version: SUPPORTED_LOCK_VERSION,
            skills: BTreeMap::new(),
            dismissed: serde_json::Value::Object(Default::default()),
            extra: BTreeMap::new(),
        }
    }
}

fn default_version() -> i32 {
    SUPPORTED_LOCK_VERSION
}

/// Ephemeral physical installation evidence; never persisted in shared state.
#[derive(Debug, Clone)]
pub struct Installation {
    pub owning_root: std::path::PathBuf,
    pub install_directory: String,
    pub home_path: std::path::PathBuf,
    pub origin: String,
    pub provenance: InstallationProvenance,
}

#[derive(Debug, Clone)]
pub enum InstallationProvenance {
    Absent,
    Tracking {
        repo: Option<String>,
        path: Option<String>,
    },
    Unreadable(String),
}

#[derive(Debug, Clone)]
pub struct LockCandidate {
    pub lock_key: String,
    pub physical_directories: Vec<String>,
    pub reason: &'static str,
}

impl std::fmt::Display for LockCandidate {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} [{}] ({})",
            self.lock_key,
            self.physical_directories.join(", "),
            self.reason
        )
    }
}

#[derive(Debug, Clone)]
pub enum LockResolution {
    Resolved {
        lock_key: String,
        entry: SkillLockEntry,
    },
    Missing {
        reason: &'static str,
    },
    Ambiguous {
        reason: &'static str,
        candidates: Vec<LockCandidate>,
    },
}

impl LockResolution {
    pub fn association(self) -> Result<Option<(String, SkillLockEntry)>, AppError> {
        match self {
            Self::Resolved { lock_key, entry } => Ok(Some((lock_key, entry))),
            Self::Missing { .. } => Ok(None),
            Self::Ambiguous { reason, candidates } => Err(AppError::BadRequest(format!(
                "lockAmbiguous: {reason}: {}",
                candidates
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            ))),
        }
    }
}

/// A read-only directory view. Never normalize the original lock key or field.
pub fn normalize_lock_skill_path(raw: &str) -> Result<String, AppError> {
    let path = raw.replace('\\', "/");
    if path.starts_with('/') || path.contains(':') || path.split('/').any(|p| p == "..") {
        return Err(AppError::BadRequest(format!(
            "Unsupported skillPath: {raw}"
        )));
    }
    let mut parts: Vec<_> = path
        .split('/')
        .filter(|p| !p.is_empty() && *p != ".")
        .collect();
    if parts.last() == Some(&"SKILL.md") {
        parts.pop();
    }
    Ok(parts.join("/"))
}

fn github_repo(raw: &str) -> Option<String> {
    let url = url::Url::parse(raw).ok()?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
        || url.scheme() != "https"
        || url.host_str()? != "github.com"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let path = url.path().trim_end_matches('/').strip_prefix('/')?;
    let path = path.strip_suffix(".git").unwrap_or(path);
    let parts: Vec<_> = path.split('/').collect();
    (parts.len() == 2 && parts.iter().all(|p| !p.is_empty())).then(|| path.to_ascii_lowercase())
}

fn corroborates(target: &Installation, entry: &SkillLockEntry) -> Option<bool> {
    let InstallationProvenance::Tracking {
        repo: Some(repo),
        path: Some(path),
    } = &target.provenance
    else {
        return None;
    };
    let repo = github_repo(repo)?;
    let (Some(owner), Some(name)) = entry.parse_source_owner_name() else {
        return Some(false);
    };
    let source_matches = repo == format!("{owner}/{name}").to_ascii_lowercase()
        && entry
            .source_url
            .as_deref()
            .is_none_or(|url| github_repo(url).as_deref() == Some(repo.as_str()));
    let Ok(path) = normalize_lock_skill_path(path) else {
        return None;
    };
    Some(
        source_matches
            && entry
                .skill_path
                .as_deref()
                .and_then(|p| normalize_lock_skill_path(p).ok())
                .as_deref()
                == Some(path.as_str()),
    )
}

fn candidate(target: &Installation, key: &str, entry: &SkillLockEntry) -> bool {
    if target.origin == "external" {
        return false;
    }
    let leaf = target.install_directory.rsplit('/').next().unwrap_or("");
    let traditional = target.origin == "ssot" && (key == target.install_directory || key == leaf);
    traditional
        || (key.contains('/')
            && key
                .split('/')
                .all(|p| !p.is_empty() && p != "." && p != "..")
            && !key.contains('\\')
            && key.rsplit('/').next() == Some(leaf)
            && corroborates(target, entry) == Some(true))
        || (target.origin == "agent"
            && (key == target.install_directory || key == leaf)
            && corroborates(target, entry) == Some(true))
}

pub fn resolve_installation_lock(
    target: &Installation,
    installations: &[Installation],
    lock: &SkillLock,
) -> LockResolution {
    if target.origin == "external" {
        return LockResolution::Missing {
            reason: "outsideLockScope",
        };
    }
    let candidates: Vec<_> = lock
        .skills
        .iter()
        .filter(|(key, entry)| candidate(target, key, entry))
        .collect();
    let evidence = |reason| {
        candidates
            .iter()
            .map(|(key, entry)| LockCandidate {
                lock_key: (*key).clone(),
                physical_directories: installations
                    .iter()
                    .filter(|i| candidate(i, key, entry))
                    .map(|i| i.home_path.to_string_lossy().into_owned())
                    .collect(),
                reason,
            })
            .collect()
    };
    if candidates.len() > 1 {
        return LockResolution::Ambiguous {
            reason: "multipleEntries",
            candidates: evidence("multipleEntries"),
        };
    }
    let Some((key, entry)) = candidates.first() else {
        return LockResolution::Missing {
            reason: if lock.skills.is_empty() {
                "noEntry"
            } else {
                "noCorroboratedAssociation"
            },
        };
    };
    if corroborates(target, entry) == Some(false) {
        return LockResolution::Ambiguous {
            reason: "conflictingEvidence",
            candidates: evidence("conflictingEvidence"),
        };
    }
    if installations
        .iter()
        .any(|other| other.home_path != target.home_path && candidate(other, key, entry))
    {
        return LockResolution::Ambiguous {
            reason: "sharedEntry",
            candidates: evidence("sharedEntry"),
        };
    }
    LockResolution::Resolved {
        lock_key: (*key).clone(),
        entry: (*entry).clone(),
    }
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
            return Ok(Self::default());
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

impl SkillLockEntry {
    /// Recorded content baseline per the documented read order:
    /// non-empty `skillFolderHash` first, then the legacy `commitSha` mirror.
    /// Empty strings count as unrecorded (older writers left placeholders).
    pub fn recorded_baseline(&self) -> Option<&str> {
        non_empty(&self.skill_folder_hash)
            .or_else(|| non_empty(&self.commit_sha))
            .map(String::as_str)
    }

    /// Both carriers hold non-empty values that disagree — an explicit conflict
    /// state that must be surfaced, never silently reconciled.
    pub fn baseline_conflict(&self) -> Option<(&str, &str)> {
        let carrier = non_empty(&self.skill_folder_hash)?;
        let mirror = non_empty(&self.commit_sha)?;
        (carrier != mirror).then(|| (carrier.as_str(), mirror.as_str()))
    }

    /// The entry carries an external pin marker and must not be auto-updated.
    pub fn is_externally_pinned(&self) -> bool {
        non_empty(&self.pinned_ref).is_some()
    }

    /// Parse owner/name from the "source" field. The documented shape is
    /// `owner/name`; anything else (missing parts, empty parts, extra
    /// segments) yields `(None, None)` so incomplete provenance surfaces as
    /// an explicit state instead of a truncated-but-plausible attribution.
    pub fn parse_source_owner_name(&self) -> (Option<String>, Option<String>) {
        let src = match &self.source {
            Some(s) => s.as_str(),
            None => return (None, None),
        };
        let mut parts = src.split('/');
        let (Some(owner), Some(name), None) = (parts.next(), parts.next(), parts.next()) else {
            return (None, None);
        };
        match (owner.is_empty(), name.is_empty()) {
            (false, false) => (Some(owner.to_string()), Some(name.to_string())),
            _ => (None, None),
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

fn non_empty(value: &Option<String>) -> Option<&String> {
    value.as_ref().filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn undeclared_entry_and_top_level_fields_survive_roundtrip() {
        let json = r#"{
            "version": 3,
            "skills": {
                "demo": {
                    "source": "owner/repo",
                    "skillFolderHash": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
                    "pinnedRef": "v1.2.3",
                    "externalNote": { "kept": true }
                }
            },
            "dismissed": {},
            "futureTopLevel": { "note": "preserve me" }
        }"#;

        let lock: SkillLock = serde_json::from_str(json).unwrap();
        let rewritten = serde_json::to_string_pretty(&lock).unwrap();
        let reread: SkillLock = serde_json::from_str(&rewritten).unwrap();

        let entry = &reread.skills["demo"];
        assert_eq!(entry.pinned_ref.as_deref(), Some("v1.2.3"));
        assert_eq!(
            entry.extra.get("externalNote"),
            Some(&serde_json::json!({ "kept": true }))
        );
        assert_eq!(
            reread.extra.get("futureTopLevel"),
            Some(&serde_json::json!({ "note": "preserve me" }))
        );
        assert_eq!(
            entry.recorded_baseline(),
            Some("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0")
        );
    }

    #[test]
    fn baseline_read_order_prefers_carrier_and_detects_conflicts() {
        let carrier_only: SkillLockEntry =
            serde_json::from_str(r#"{"skillFolderHash": "aa"}"#).unwrap();
        assert_eq!(carrier_only.recorded_baseline(), Some("aa"));
        assert!(carrier_only.baseline_conflict().is_none());

        let mirror_only: SkillLockEntry = serde_json::from_str(r#"{"commitSha": "bb"}"#).unwrap();
        assert_eq!(mirror_only.recorded_baseline(), Some("bb"));

        let both_equal: SkillLockEntry =
            serde_json::from_str(r#"{"skillFolderHash": "aa", "commitSha": "aa"}"#).unwrap();
        assert_eq!(both_equal.recorded_baseline(), Some("aa"));
        assert!(both_equal.baseline_conflict().is_none());

        let disagreeing: SkillLockEntry =
            serde_json::from_str(r#"{"skillFolderHash": "aa", "commitSha": "bb"}"#).unwrap();
        assert_eq!(disagreeing.baseline_conflict(), Some(("aa", "bb")));

        // Empty strings are legacy placeholders, not recorded baselines.
        let placeholders: SkillLockEntry =
            serde_json::from_str(r#"{"skillFolderHash": "", "commitSha": ""}"#).unwrap();
        assert_eq!(placeholders.recorded_baseline(), None);

        let pinned: SkillLockEntry = serde_json::from_str(r#"{"pinnedRef": "v1"}"#).unwrap();
        assert!(pinned.is_externally_pinned());
        let empty_pinned: SkillLockEntry = serde_json::from_str(r#"{"pinnedRef": ""}"#).unwrap();
        assert!(!empty_pinned.is_externally_pinned());
        let unpinned: SkillLockEntry = serde_json::from_str(r#"{}"#).unwrap();
        assert!(!unpinned.is_externally_pinned());
    }

    #[test]
    fn source_parsing_accepts_only_owner_name_shape() {
        let entry = |source: &str| SkillLockEntry {
            source: Some(source.to_string()),
            ..Default::default()
        };

        assert_eq!(
            entry("anthropics/skills").parse_source_owner_name(),
            (Some("anthropics".into()), Some("skills".into()))
        );
        // Incomplete or malformed shapes must not truncate into a plausible
        // attribution — they surface as unparsed instead.
        for malformed in ["owner/", "/repo", "owner/repo/extra", "", "/"] {
            assert_eq!(
                entry(malformed).parse_source_owner_name(),
                (None, None),
                "source {malformed:?} should not parse"
            );
        }
        let missing = SkillLockEntry::default();
        assert_eq!(missing.parse_source_owner_name(), (None, None));
    }
}
