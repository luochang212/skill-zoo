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
        entry: Box<SkillLockEntry>,
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
            Self::Resolved { lock_key, entry } => Ok(Some((lock_key, *entry))),
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
        entry: Box::new((*entry).clone()),
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

    /// Apply verified baseline-conflict alignments in one lock write: both
    /// carrier fields of each listed entry are set to the verified value and
    /// no other field is touched (docs/local-protocol.md, verified-conflict
    /// resolution). Callers must already hold the agent lease when this can
    /// race a CLI writer.
    pub fn apply_verified_alignments(alignments: &[(String, String)]) -> Result<(), AppError> {
        if alignments.is_empty() {
            return Ok(());
        }
        Self::update(|lock| {
            for (lock_key, sha) in alignments {
                if let Some(entry) = lock.skills.get_mut(lock_key) {
                    entry.skill_folder_hash = Some(sha.clone());
                    entry.commit_sha = Some(sha.clone());
                }
            }
            Ok(())
        })
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
        (carrier != mirror).then_some((carrier.as_str(), mirror.as_str()))
    }

    /// Verified-conflict resolution (docs/local-protocol.md): a conflicted
    /// entry whose installed content's tree SHA equals exactly one recorded
    /// carrier resolves to aligning both carriers to that measured value.
    /// Missing or unreadable directories, content matching neither carrier,
    /// and externally pinned entries (whose recorded fields must stay
    /// unchanged) keep the explicit conflict state.
    pub fn baseline_conflict_resolution(
        &self,
        install_directory: &Path,
    ) -> BaselineConflictResolution {
        let Some((carrier, mirror)) = self.baseline_conflict() else {
            return BaselineConflictResolution::NotConflicted;
        };
        if self.is_externally_pinned() {
            return BaselineConflictResolution::Unverifiable;
        }
        let sha = match content_tree_sha(install_directory) {
            Ok(sha) => sha,
            Err(_) => return BaselineConflictResolution::Unverifiable,
        };
        if sha == carrier || sha == mirror {
            BaselineConflictResolution::Verified(sha)
        } else {
            BaselineConflictResolution::Unverifiable
        }
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

/// Outcome of the verified-conflict resolution for one lock entry
/// (docs/local-protocol.md): a conflicted entry whose installed content
/// matches exactly one recorded carrier is aligned to that measured value;
/// anything that cannot be verified keeps the explicit conflict state.
#[derive(Debug, Clone, PartialEq)]
pub enum BaselineConflictResolution {
    /// Carriers agree or only one holds a value — no conflict to resolve.
    NotConflicted,
    /// Local content tree SHA matches exactly one recorded carrier.
    Verified(String),
    /// Directory missing/unreadable, content matches neither carrier, or the
    /// entry is externally pinned (pinned fields stay unchanged, E1).
    Unverifiable,
}

/// Compute the git tree SHA of a directory's content, reproducing the object
/// convention the recorded baselines use (git object hashing: `blob`/`tree`
/// SHA-1 over `"{type} {length}\0{content}"`, tree entries sorted with
/// directories compared as `name/`, modes `100644`/`100755`/`120000`, tree
/// mode `40000`). Empty subtrees are pruned — git trees cannot represent
/// contentless directories, so an empty directory hashes as the empty tree.
pub fn content_tree_sha(directory: &Path) -> Result<String, AppError> {
    match dir_tree_sha(directory)? {
        Some(sha) => Ok(hex_sha(&sha)),
        None => Ok(hex_sha(&object_sha_raw(b"tree", &[]))),
    }
}

fn dir_tree_sha(directory: &Path) -> Result<Option<[u8; 20]>, AppError> {
    let mut entries: Vec<(Vec<u8>, &'static str, String, [u8; 20])> = Vec::new();
    for result in std::fs::read_dir(directory)? {
        let entry = result?;
        // Git never tracks `.git` entries; recorded baselines (GitHub trees)
        // cannot contain them either.
        if entry.file_name() == ".git" {
            continue;
        }
        let file_type = entry.file_type()?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let (mode, sha, is_dir) = if file_type.is_symlink() {
            let target = std::fs::read_link(entry.path())?;
            (
                "120000",
                object_sha_raw(b"blob", target.as_os_str().as_encoded_bytes()),
                false,
            )
        } else if file_type.is_dir() {
            match dir_tree_sha(&entry.path())? {
                Some(sha) => ("40000", sha, true),
                None => continue,
            }
        } else {
            let bytes = std::fs::read(entry.path())?;
            (
                file_mode(&entry.metadata()?),
                object_sha_raw(b"blob", &bytes),
                false,
            )
        };
        // Git tree sort compares directory names as if suffixed with '/'.
        let mut sort_key = name.clone().into_bytes();
        if is_dir {
            sort_key.push(b'/');
        }
        entries.push((sort_key, mode, name, sha));
    }
    if entries.is_empty() {
        return Ok(None);
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let mut body = Vec::new();
    for (_, mode, name, sha) in &entries {
        body.extend_from_slice(format!("{mode} {name}").as_bytes());
        body.push(0);
        body.extend_from_slice(sha);
    }
    Ok(Some(object_sha_raw(b"tree", &body)))
}

/// SHA-1 of a git object: `"{type} {byte length}\0{content}"`.
fn object_sha_raw(kind: &[u8], content: &[u8]) -> [u8; 20] {
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(kind);
    hasher.update(b" ");
    hasher.update(content.len().to_string().as_bytes());
    hasher.update(b"\0");
    hasher.update(content);
    let hash = hasher.finalize();
    let mut out = [0u8; 20];
    out.copy_from_slice(&hash);
    out
}

fn hex_sha(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(unix)]
fn file_mode(metadata: &std::fs::Metadata) -> &'static str {
    use std::os::unix::fs::PermissionsExt;
    if metadata.permissions().mode() & 0o111 != 0 {
        "100755"
    } else {
        "100644"
    }
}

#[cfg(not(unix))]
fn file_mode(_metadata: &std::fs::Metadata) -> &'static str {
    "100644"
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

    /// Hash a temp directory with real `git` (init → add → write-tree) and
    /// compare against `content_tree_sha` across the shapes git objects
    /// actually encode: nesting, exec bits, symlinks, unicode/space names,
    /// binary content, and directories git would ignore as empty.
    #[test]
    fn content_tree_sha_matches_git_object_hashing() {
        let git_available = || {
            matches!(
                std::process::Command::new("git").arg("--version").output(),
                Ok(output) if output.status.success()
            )
        };
        if !git_available() {
            eprintln!("git not available; skipping git-parity test");
            return;
        }
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        std::fs::create_dir_all(root.join("nested/sub")).unwrap();
        std::fs::write(root.join("SKILL.md"), b"# skill\n\nbody\n").unwrap();
        std::fs::write(root.join("nested/deep.txt"), b"deep\n").unwrap();
        std::fs::write(
            root.join("nested/sub/leaf.md"),
            "unicode ✓ 内容\n".as_bytes(),
        )
        .unwrap();
        std::fs::write(root.join("exec.sh"), b"#!/bin/sh\necho hi\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(root.join("exec.sh"), std::fs::Permissions::from_mode(0o755))
                .unwrap();
            std::os::unix::fs::symlink("SKILL.md", root.join("link.md")).unwrap();
        }
        std::fs::write(root.join("with space.md"), b"spaces in names\n").unwrap();
        // Binary content exercises the length-prefixed object header.
        let binary: Vec<u8> = (0..=255u8).cycle().take(1000).collect();
        std::fs::write(root.join("blob.bin"), &binary).unwrap();
        // Empty subtrees must be pruned (git cannot represent them).
        std::fs::create_dir_all(root.join("empty_dir/empty_nested")).unwrap();

        let status = std::process::Command::new("git")
            .args(["init", "-q"])
            .current_dir(root)
            .status()
            .unwrap();
        assert!(status.success());
        let status = std::process::Command::new("git")
            .args(["add", "-A", "-f"])
            .current_dir(root)
            .status()
            .unwrap();
        assert!(status.success());
        let output = std::process::Command::new("git")
            .args(["write-tree"])
            .current_dir(root)
            .output()
            .unwrap();
        assert!(output.status.success(), "git write-tree failed");
        let git_tree = String::from_utf8_lossy(&output.stdout).trim().to_string();

        assert_eq!(content_tree_sha(root).unwrap(), git_tree);
    }

    /// Field-evidence oracle: the recorded remote tree of
    /// `skills/openspec-explore` (Fission-AI/OpenSpec, `83b5a650…`) contains
    /// exactly this SKILL.md content; the helper must reproduce it.
    #[test]
    fn content_tree_sha_reproduces_field_recorded_tree() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../fixtures/local-protocol/tree-oracle-openspec-explore.md");
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join("SKILL.md"),
            std::fs::read(&fixture).unwrap(),
        )
        .unwrap();

        assert_eq!(
            content_tree_sha(temp.path()).unwrap(),
            "83b5a6507712af9d4225f5503bbf77c53eab57a4"
        );
    }

    #[test]
    fn verified_conflict_resolution_aligns_only_to_a_matching_carrier() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        std::fs::write(dir.join("SKILL.md"), b"content\n").unwrap();
        let sha = content_tree_sha(dir).unwrap();
        let other = "ffffffffffffffffffffffffffffffffffffffff";
        let entry = |fh: &str, cs: &str| -> SkillLockEntry {
            serde_json::from_str(&format!(
                r#"{{"skillFolderHash": "{fh}", "commitSha": "{cs}"}}"#
            ))
            .unwrap()
        };

        // No conflict: carriers agree.
        assert_eq!(
            entry(&sha, &sha).baseline_conflict_resolution(dir),
            BaselineConflictResolution::NotConflicted
        );
        // Single-carrier entries are not conflicts either.
        assert_eq!(
            serde_json::from_str::<SkillLockEntry>(r#"{"skillFolderHash": "aa"}"#)
                .unwrap()
                .baseline_conflict_resolution(dir),
            BaselineConflictResolution::NotConflicted
        );
        // Content matches the carrier → align to it.
        assert_eq!(
            entry(&sha, other).baseline_conflict_resolution(dir),
            BaselineConflictResolution::Verified(sha.clone())
        );
        // Content matches the mirror → align to it (field-evidenced direction).
        assert_eq!(
            entry(other, &sha).baseline_conflict_resolution(dir),
            BaselineConflictResolution::Verified(sha.clone())
        );
        // Content matches neither carrier → keep the explicit conflict.
        assert_eq!(
            entry(other, "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")
                .baseline_conflict_resolution(dir),
            BaselineConflictResolution::Unverifiable
        );
        // Missing directory → unverifiable.
        assert_eq!(
            entry(&sha, other).baseline_conflict_resolution(&dir.join("nonexistent")),
            BaselineConflictResolution::Unverifiable
        );
        // Externally pinned entries keep their recorded fields unchanged (E1).
        let pinned: SkillLockEntry = serde_json::from_str(&format!(
            r#"{{"skillFolderHash": "{sha}", "commitSha": "{other}", "pinnedRef": "v1"}}"#
        ))
        .unwrap();
        assert_eq!(
            pinned.baseline_conflict_resolution(dir),
            BaselineConflictResolution::Unverifiable
        );
    }

    #[test]
    fn empty_directory_hashes_as_gits_empty_tree() {
        let temp = tempfile::tempdir().unwrap();
        // sha1("tree 0\0") — git's well-known empty tree object.
        assert_eq!(
            content_tree_sha(temp.path()).unwrap(),
            "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
        );
    }
}
