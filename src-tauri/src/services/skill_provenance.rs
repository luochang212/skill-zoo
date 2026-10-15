//! Conservative, read-only authorization for replacing an installed skill.
use crate::{config, error::AppError};
use serde_yaml::Value;
use std::path::{Component, Path, PathBuf};

const RESERVED: &[&str] = &[
    "github-repo",
    "github-ref",
    "github-tree-sha",
    "github-path",
    "github-pinned",
    "github-owner",
    "github-sha",
];

#[derive(Debug, PartialEq, Eq)]
pub enum Provenance {
    Absent,
    Tracking,
    Unreadable(String),
}

/// Only a leading, independently delimited YAML document grants authorization.
/// Display parsing is deliberately separate: its lossy fallback is unsafe here.
pub fn inspect_gh_tracking(text: &str) -> Provenance {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = text.lines();
    let Some(first) = lines.find(|line| !line.trim().is_empty()) else {
        return Provenance::Absent;
    };
    if first.trim_end_matches([' ', '\t']) != "---" {
        return Provenance::Absent;
    }
    let mut yaml = String::new();
    let mut closed = false;
    for line in lines {
        if line.trim_end_matches([' ', '\t']) == "---" {
            closed = true;
            break;
        }
        yaml.push_str(line);
        yaml.push('\n');
    }
    if !closed {
        return Provenance::Unreadable("Unclosed YAML frontmatter".into());
    }
    let mut value: Value = match serde_yaml::from_str(&yaml) {
        Ok(value) => value,
        Err(error) => return Provenance::Unreadable(error.to_string()),
    };
    fn has_tag(value: &Value) -> bool {
        match value {
            Value::Tagged(_) => true,
            Value::Sequence(items) => items.iter().any(has_tag),
            Value::Mapping(map) => map
                .iter()
                .any(|(key, value)| has_tag(key) || has_tag(value)),
            _ => false,
        }
    }
    if has_tag(&value) {
        return Provenance::Unreadable("Unsupported YAML tag".into());
    }
    if let Err(error) = value.apply_merge() {
        return Provenance::Unreadable(error.to_string());
    }
    if let Some(metadata) = value.get("metadata").and_then(Value::as_mapping) {
        if RESERVED
            .iter()
            .any(|key| metadata.contains_key(Value::String((*key).into())))
        {
            return Provenance::Tracking;
        }
    }
    Provenance::Absent
}

#[derive(Debug, Clone)]
pub struct GuardIssue {
    pub code: &'static str,
    pub message: String,
}

impl GuardIssue {
    fn unreadable(reason: impl std::fmt::Display) -> Self {
        Self { code: "skillProvenanceUnreadable", message: format!("Cannot safely read SKILL.md tracking information; no update was made. Check the file and retry. {reason}") }
    }

    fn changed() -> Self {
        Self {
            code: "updateStateChanged",
            message: "The update target changed during checking or download. Check updates again."
                .into(),
        }
    }
}

impl std::fmt::Display for GuardIssue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl From<GuardIssue> for AppError {
    fn from(issue: GuardIssue) -> Self {
        AppError::UpdateGuard {
            code: issue.code,
            message: issue.message,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct TargetIdentity {
    real_path: PathBuf,
    created: Option<std::time::SystemTime>,
    #[cfg(unix)]
    inode: (u64, u64),
}

#[derive(Debug)]
pub struct UpdateSnapshot {
    identity: TargetIdentity,
    bytes: Vec<u8>,
}

fn read_target(home: &Path) -> Result<UpdateSnapshot, GuardIssue> {
    let metadata = std::fs::symlink_metadata(home).map_err(GuardIssue::unreadable)?;
    if !metadata.is_dir() || crate::services::skill::is_symlink_or_junction(home) {
        return Err(GuardIssue::unreadable("Expected a real skill directory"));
    }
    let real_path = home.canonicalize().map_err(GuardIssue::unreadable)?;
    let identity = TargetIdentity {
        real_path,
        created: metadata.created().ok(),
        #[cfg(unix)]
        inode: {
            use std::os::unix::fs::MetadataExt;
            (metadata.dev(), metadata.ino())
        },
    };
    let bytes = std::fs::read(home.join("SKILL.md")).map_err(GuardIssue::unreadable)?;
    Ok(UpdateSnapshot { identity, bytes })
}

pub fn read_gh_tracking(home: &Path) -> Provenance {
    match read_target(home) {
        Ok(snapshot) => match std::str::from_utf8(&snapshot.bytes) {
            Ok(text) => inspect_gh_tracking(text),
            Err(error) => Provenance::Unreadable(error.to_string()),
        },
        Err(error) => Provenance::Unreadable(error.message),
    }
}

pub fn ensure_update_allowed(home: &Path) -> Result<UpdateSnapshot, GuardIssue> {
    let snapshot = read_target(home)?;
    let text = std::str::from_utf8(&snapshot.bytes).map_err(GuardIssue::unreadable)?;
    match inspect_gh_tracking(text) {
        Provenance::Absent => Ok(snapshot),
        Provenance::Tracking => Err(GuardIssue { code: "ghProvenanceProtected", message: "This skill contains gh GitHub tracking information. Skill Zoo cannot yet preserve it during updates. Use gh to update; changing management requires a separate explicit operation.".into() }),
        Provenance::Unreadable(reason) => Err(GuardIssue::unreadable(reason)),
    }
}

/// Validate the physical SSOT boundary without interpreting a lock key.
pub fn update_target(name: &str) -> Result<PathBuf, GuardIssue> {
    let relative = Path::new(name);
    if name.is_empty()
        || !relative
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
    {
        return Err(GuardIssue::unreadable("Invalid installation directory"));
    }
    let root = config::get_agents_skills_dir();
    let target = root.join(relative);
    let real_root = root.canonicalize().map_err(GuardIssue::unreadable)?;
    let real_target = target.canonicalize().map_err(GuardIssue::unreadable)?;
    if !real_target.starts_with(&real_root) || real_target == real_root {
        return Err(GuardIssue::unreadable("Target is outside the SSOT store"));
    }
    Ok(target)
}

pub fn prepare_update(name: &str) -> Result<UpdateSnapshot, GuardIssue> {
    ensure_update_allowed(&update_target(name)?)
}

pub fn revalidate_update_target(home: &Path, snapshot: &UpdateSnapshot) -> Result<(), GuardIssue> {
    let current = read_target(home).map_err(|_| GuardIssue::changed())?;
    if current.identity != snapshot.identity || current.bytes != snapshot.bytes {
        return Err(GuardIssue::changed());
    }
    Ok(())
}
