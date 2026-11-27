use crate::config;
use crate::error::AppError;
use crate::persistence::agent_transaction::AgentLease;
use crate::persistence::archive::SUPPORTED_ARCHIVE_VERSION;
use crate::persistence::external_imports::SUPPORTED_EXTERNAL_IMPORTS_VERSION;
use crate::persistence::{
    ArchiveManifest, ArchivedSkill, ExternalImports, MetadataStore, SkillCache, SkillCacheEntry,
};
use crate::services::lock::{SkillLock, SkillLockEntry, SUPPORTED_LOCK_VERSION};
use crate::services::skill::{
    is_symlink_or_junction, plugin_read_only_error, same_directory, InstalledSkill, SkillService,
};
use crate::services::update_exit::UpdateGuard;
use crate::store::AppState;
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

static ARCHIVE_ID_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$").unwrap());

fn validate_archive_id(archive_id: &str) -> Result<(), String> {
    if !ARCHIVE_ID_RE.is_match(archive_id) {
        return Err("Invalid archive id".into());
    }
    Ok(())
}

fn format_archive_io_error(action: &str, path: &std::path::Path, error: &std::io::Error) -> String {
    let detail = match error.kind() {
        std::io::ErrorKind::PermissionDenied => {
            "Permission denied. On Windows this often means the skill folder or one of its files is open in another app, terminal, antivirus scan, or file indexer."
        }
        std::io::ErrorKind::AlreadyExists => {
            "The destination already exists. Resolve the conflicting folder before trying again."
        }
        std::io::ErrorKind::NotFound => {
            "The source folder is missing. Refresh the local skills list and try again."
        }
        _ => {
            let msg = error.to_string().to_lowercase();
            if msg.contains("cross-device")
                || msg.contains("different device")
                || msg.contains("not same device")
                || msg.contains("not on the same device")
                || msg.contains("os error 17")
            {
                "The source and destination appear to be on different drives or volumes. Skill Zoo cannot move archived skills across filesystems safely yet."
            } else if msg.contains("access is denied") || msg.contains("being used by another process") {
                "Access was denied. On Windows this often means the skill folder or one of its files is open in another app, terminal, antivirus scan, or file indexer."
            } else {
                "Filesystem operation failed."
            }
        }
    };
    format!("{action} failed for {}: {detail} ({error})", path.display())
}

fn format_archive_app_error(action: &str, error: impl std::fmt::Display) -> String {
    let message = error.to_string();
    let lower = message.to_lowercase();
    let detail = if lower.contains("access is denied")
        || lower.contains("permission denied")
        || lower.contains("being used by another process")
    {
        "Permission denied. On Windows this often means a file or folder is open in another app, terminal, antivirus scan, or file indexer."
    } else if lower.contains("cross-device")
        || lower.contains("different device")
        || lower.contains("not same device")
        || lower.contains("not on the same device")
        || lower.contains("os error 17")
    {
        "The source and destination appear to be on different drives or volumes. Skill Zoo cannot move archived skills across filesystems safely yet."
    } else {
        return format!("{action} failed: {message}");
    };
    format!("{action} failed: {detail} ({message})")
}

struct ArchiveWrite<'a> {
    imports: ExternalImports,
    _refresh: tokio::sync::MutexGuard<'a, ()>,
    _lease: AgentLease,
    _update: UpdateGuard<'a>,
}

impl<'a> ArchiveWrite<'a> {
    async fn begin(state: &'a AppState) -> Result<Self, String> {
        let update = state.update_exit.start_update();
        let lease = state.acquire_local_lease().map_err(|e| e.to_string())?;
        let refresh = state.cache_refresh_lock.lock().await;
        let imports = ExternalImports::load().map_err(|e| e.to_string())?;
        if imports.version > SUPPORTED_EXTERNAL_IMPORTS_VERSION {
            return Err(format!("External imports version {} is newer than this desktop app supports. Upgrade Skill Zoo before writing.", imports.version));
        }
        Ok(Self {
            imports,
            _refresh: refresh,
            _lease: lease,
            _update: update,
        })
    }
}

struct ArchiveSnapshot {
    cache: SkillCache,
    metadata: MetadataStore,
    manifest: ArchiveManifest,
    lock: SkillLock,
    lock_existed: bool,
}

impl ArchiveSnapshot {
    fn capture(state: &AppState) -> Result<Self, String> {
        let manifest = ArchiveManifest::load().map_err(|e| e.to_string())?;
        let lock = SkillLock::read().map_err(|e| e.to_string())?;
        assert_writable_schema(&lock, &manifest)?;
        Ok(Self {
            cache: state.skill_cache.read().map_err(|e| e.to_string())?.clone(),
            metadata: state.metadata.read().map_err(|e| e.to_string())?.clone(),
            manifest,
            lock,
            lock_existed: config::get_agent_lock_file().exists(),
        })
    }

    fn restore(&self, state: &AppState) -> Vec<String> {
        let mut errors = Vec::new();
        let cache_result = state
            .skill_cache
            .write()
            .map_err(|e| e.to_string())
            .and_then(|mut cache| {
                *cache = self.cache.clone();
                cache.save().map_err(|e| e.to_string())
            });
        if let Err(e) = cache_result {
            errors.push(format!("restore cache: {e}"));
        }
        let metadata_result =
            state
                .metadata
                .write()
                .map_err(|e| e.to_string())
                .and_then(|mut metadata| {
                    *metadata = self.metadata.clone();
                    metadata.save().map_err(|e| e.to_string())
                });
        if let Err(e) = metadata_result {
            errors.push(format!("restore metadata: {e}"));
        }
        if let Err(e) = self.manifest.save() {
            errors.push(format!("restore manifest: {e}"));
        }
        if let Err(e) = SkillLock::restore_snapshot(self.lock_existed.then_some(&self.lock)) {
            errors.push(format!("restore lock: {e}"));
        }
        errors
    }
}

fn recovery_error(message: String, errors: Vec<String>) -> String {
    if errors.is_empty() {
        message
    } else {
        format!("{message}. Recovery incomplete: {}", errors.join("; "))
    }
}

#[derive(Debug)]
enum ArchiveOwner {
    Store,
    Agent(String),
}

impl ArchiveOwner {
    fn resolve(
        origin: &str,
        home_agent: Option<&str>,
        name: &str,
        plugin_source: Option<&str>,
    ) -> Result<Self, String> {
        match origin {
            "ssot" => Ok(Self::Store),
            "agent" => home_agent.map(|id| Self::Agent(id.into())).ok_or_else(|| "Agent skill has no home agent".into()),
            "external" => Err("External imports cannot be archived because their source folders are owned by the user.".into()),
            "plugin" => Err(plugin_read_only_error(name, plugin_source)),
            _ => Err(format!("Unknown skill origin: {origin}")),
        }
    }

    fn root(&self) -> Result<PathBuf, String> {
        match self {
            Self::Store => Ok(config::get_agents_skills_dir()),
            Self::Agent(id) => {
                config::get_agent_skills_dir(id).ok_or_else(|| format!("Unknown agent: {id}"))
            }
        }
    }

    fn scan(&self, home: &Path) -> Result<crate::persistence::SkillCacheEntry, String> {
        let agent = match self {
            Self::Store => None,
            Self::Agent(id) => Some(id.as_str()),
        };
        SkillService::scan_skill_root(home, &self.root()?, agent, None).map_err(|e| e.to_string())
    }
}

struct ArchiveTarget {
    skill: InstalledSkill,
    home: PathBuf,
    owner: ArchiveOwner,
}

impl ArchiveTarget {
    fn resolve(
        write: &ArchiveWrite<'_>,
        installed_by_id: &HashMap<String, InstalledSkill>,
        skill_id: &str,
    ) -> Result<Self, String> {
        let skill = installed_by_id
            .get(skill_id)
            .cloned()
            .ok_or_else(|| format!("Skill not found: {skill_id}"))?;
        let home = PathBuf::from(
            skill
                .home_path
                .as_ref()
                .ok_or_else(|| "Skill has no physical home path, cannot archive".to_string())?,
        );
        let is_import = write.imports.imports.values().any(|import| {
            import.id == skill.id || same_directory(Path::new(&import.source_path), &home)
        });
        let origin = if is_import {
            "external"
        } else {
            skill.origin.as_str()
        };
        let owner = ArchiveOwner::resolve(
            origin,
            skill.home_agent.as_deref(),
            &skill.name,
            skill.plugin_source.as_deref(),
        )?;
        if !home.is_dir() || is_symlink_or_junction(&home) || !home.join("SKILL.md").is_file() {
            return Err(format!(
                "Skill home path is not an archiveable directory: {}",
                home.display()
            ));
        }
        let directory = Path::new(&skill.directory);
        if directory.as_os_str().is_empty()
            || directory
                .components()
                .any(|part| !matches!(part, std::path::Component::Normal(_)))
        {
            return Err("Invalid skill directory".into());
        }
        let root = owner.root()?;
        let expected = root.join(directory);
        let real_home = home.canonicalize().map_err(|e| e.to_string())?;
        if is_symlink_or_junction(&expected)
            || !same_directory(&home, &expected)
            || !real_home
                .ancestors()
                .any(|parent| same_directory(parent, &root))
        {
            return Err(
                "Skill home no longer matches its recorded owner and directory. Refresh and retry."
                    .into(),
            );
        }
        Ok(Self { skill, home, owner })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSkillsResult {
    pub archived: Vec<String>,
    pub failed: Vec<ArchiveSkillFailure>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSkillFailure {
    pub skill_id: String,
    pub error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreArchivedSkillsResult {
    pub restored: Vec<RestoredArchivedSkill>,
    pub failed: Vec<RestoreArchivedSkillFailure>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub skipped_agents: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredArchivedSkill {
    pub archive_id: String,
    pub skill: InstalledSkill,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreArchivedSkillFailure {
    pub archive_id: String,
    pub error: String,
}

pub fn get_archived_skills() -> Result<Vec<ArchivedSkill>, String> {
    let manifest = ArchiveManifest::load().map_err(|e| e.to_string())?;
    let mut skills: Vec<ArchivedSkill> = manifest.skills.values().cloned().collect();
    skills.sort_by(|a, b| {
        b.archived_at
            .cmp(&a.archived_at)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(skills)
}

pub fn read_archived_skill_md(archive_id: String) -> Result<String, String> {
    validate_archive_id(&archive_id)?;
    let manifest = ArchiveManifest::load().map_err(|e| e.to_string())?;
    let archived_skill = manifest
        .skills
        .get(&archive_id)
        .cloned()
        .ok_or_else(|| format!("Archived skill not found: {archive_id}"))?;

    let skill_md = if archived_skill.origin == "external" {
        archived_skill
            .home_path
            .as_ref()
            .map(std::path::PathBuf::from)
            .ok_or_else(|| "Archived external import has no source path recorded".to_string())?
            .join("SKILL.md")
    } else {
        ArchiveManifest::archive_skill_dir(&archive_id).join("SKILL.md")
    };

    if !skill_md.exists() {
        return Err(format!(
            "Archived SKILL.md is missing for {archive_id}: {}. The archive entry exists, but its files may have been moved or deleted outside Skill Zoo.",
            skill_md.display()
        ));
    }
    std::fs::read_to_string(&skill_md)
        .map_err(|e| format_archive_io_error("Read archived SKILL.md", &skill_md, &e))
}

struct PreparedArchive {
    skill_id: String,
    archive_id: String,
    archived_skill: ArchivedSkill,
    home: PathBuf,
    archive_dir: PathBuf,
    lock_key: Option<String>,
    removed_agents: Vec<String>,
    moved: bool,
}

impl PreparedArchive {
    fn undo(&self) -> Vec<String> {
        let mut errors = Vec::new();
        if self.moved && self.archive_dir.exists() && !self.home.exists() {
            if let Some(parent) = self.home.parent() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    errors.push(format!("recreate skill parent: {e}"));
                }
            }
            if let Err(e) = std::fs::rename(&self.archive_dir, &self.home) {
                errors.push(format!("move archived skill back home: {e}"));
            }
        }
        for agent in &self.removed_agents {
            if let Err(e) = SkillService::toggle_symlink(
                &self.archived_skill.directory,
                &self.home.to_string_lossy(),
                agent,
                true,
            ) {
                errors.push(format!("restore agent symlink: {e}"));
            }
        }
        errors
    }
}

fn prepare_archive(
    write: &ArchiveWrite<'_>,
    installed_by_id: &HashMap<String, InstalledSkill>,
    manifest: &ArchiveManifest,
    lock: &SkillLock,
    skill_id: String,
) -> Result<PreparedArchive, String> {
    let target = ArchiveTarget::resolve(write, installed_by_id, &skill_id)?;
    let skill = target.skill.clone();
    let home = target.home.clone();

    let archive_id = ArchiveManifest::make_archive_id(&skill.id, &skill.directory);
    validate_archive_id(&archive_id)?;
    let archive_dir = ArchiveManifest::archive_skill_dir(&archive_id);
    if archive_dir.exists() {
        return Err(format!(
            "Cannot archive {}: archive destination already exists at {}. Restore or move that archived copy before trying again.",
            skill.name,
            archive_dir.display()
        ));
    }
    if manifest.skills.contains_key(&archive_id) {
        return Err(format!("Skill is already archived: {}", skill.name));
    }

    let lock_key = if !matches!(target.owner, ArchiveOwner::Store) {
        None
    } else if lock.skills.contains_key(&skill.directory) {
        Some(skill.directory.clone())
    } else if lock.skills.contains_key(&skill.name) {
        Some(skill.name.clone())
    } else {
        None
    };
    let lock_entry = lock_key
        .as_ref()
        .and_then(|key| lock.skills.get(key).cloned());
    let archived_skill = ArchivedSkill::from_installed(
        skill.clone(),
        archive_id.clone(),
        lock_key.clone(),
        lock_entry,
    );

    Ok(PreparedArchive {
        skill_id: skill.id,
        archive_id,
        archived_skill,
        home,
        archive_dir,
        lock_key,
        removed_agents: Vec::new(),
        moved: false,
    })
}

pub async fn archive_skills(
    state: &AppState,
    skill_ids: Vec<String>,
) -> Result<ArchiveSkillsResult, String> {
    let write = ArchiveWrite::begin(state).await?;
    let mut archived: Vec<String> = Vec::new();
    let mut failed: Vec<ArchiveSkillFailure> = Vec::new();

    let installed_by_id: HashMap<String, InstalledSkill> =
        SkillService::read_all_skills(&state.skill_cache, &state.metadata)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|skill| (skill.id.clone(), skill))
            .collect();
    let mut manifest = ArchiveManifest::load().map_err(|e| e.to_string())?;
    let lock = SkillLock::read().map_err(|e| e.to_string())?;

    let mut prepared: Vec<PreparedArchive> = Vec::new();
    for skill_id in skill_ids {
        match prepare_archive(&write, &installed_by_id, &manifest, &lock, skill_id.clone()) {
            Ok(item) => {
                manifest
                    .skills
                    .insert(item.archive_id.clone(), item.archived_skill.clone());
                prepared.push(item);
            }
            Err(e) => failed.push(ArchiveSkillFailure { skill_id, error: e }),
        }
    }
    if prepared.is_empty() {
        return Ok(ArchiveSkillsResult { archived, failed });
    }

    let snapshot = ArchiveSnapshot::capture(state)?;

    for item in &mut prepared {
        let mut item_error: Option<String> = None;
        if let Some(parent) = item.archive_dir.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                item_error = Some(format_archive_io_error(
                    "Create archive directory",
                    parent,
                    &e,
                ));
            }
        }
        if item_error.is_none() {
            for (agent, enabled) in &item.archived_skill.apps {
                if !enabled {
                    continue;
                }
                if item.archived_skill.home_agent.as_deref() == Some(agent.as_str()) {
                    let flat_path = config::get_agent_skills_dir(agent).map(|root| {
                        root.join(SkillService::agent_link_name(
                            &item.archived_skill.directory,
                        ))
                    });
                    if flat_path.is_none_or(|path| !is_symlink_or_junction(&path)) {
                        continue;
                    }
                }
                match SkillService::toggle_symlink(
                    &item.archived_skill.directory,
                    &item.home.to_string_lossy(),
                    agent,
                    false,
                ) {
                    Ok(()) => item.removed_agents.push(agent.clone()),
                    Err(e) => {
                        item_error = Some(format_archive_app_error(
                            "Remove agent link while archiving",
                            e,
                        ));
                        break;
                    }
                }
            }
        }
        if item_error.is_none() {
            match std::fs::rename(&item.home, &item.archive_dir) {
                Ok(()) => item.moved = true,
                Err(e) => {
                    item_error = Some(format_archive_io_error(
                        "Move skill into archive",
                        &item.archive_dir,
                        &e,
                    ));
                }
            }
        }
        if let Some(message) = item_error {
            let undo_errors = item.undo();
            let error = if undo_errors.is_empty() {
                message
            } else {
                recovery_error(message, undo_errors)
            };
            failed.push(ArchiveSkillFailure {
                skill_id: item.skill_id.clone(),
                error,
            });
            manifest.skills.remove(&item.archive_id);
            continue;
        }
        archived.push(item.skill_id.clone());
    }

    if !archived.is_empty() {
        let succeeded_ids: std::collections::HashSet<&String> = archived.iter().collect();
        let succeeded = |item: &PreparedArchive| succeeded_ids.contains(&item.skill_id);
        let persist = (|| -> Result<(), String> {
            manifest.save().map_err(|e| e.to_string())?;

            let lock_keys: Vec<&str> = prepared
                .iter()
                .filter(|item| succeeded(item))
                .filter_map(|item| item.lock_key.as_deref())
                .collect();
            if !lock_keys.is_empty() {
                SkillLock::update(|lock| {
                    for key in lock_keys {
                        lock.skills.remove(key);
                    }
                    Ok::<(), AppError>(())
                })
                .map_err(|e| e.to_string())?;
            }

            let ids: Vec<String> = prepared
                .iter()
                .filter(|item| succeeded(item))
                .map(|item| item.archived_skill.original_skill_id.clone())
                .collect();
            if !ids.is_empty() {
                SkillService::remove_cache_entries(&state.skill_cache, &ids)
                    .map_err(|e| e.to_string())?;

                let mut metadata = state.metadata.write().map_err(|e| e.to_string())?;
                for id in &ids {
                    metadata.remove(id);
                }
                metadata.save().map_err(|e| e.to_string())?;
            }
            Ok(())
        })();

        if let Err(persist_error) = persist {
            let mut errors = Vec::new();
            for item in prepared.iter().filter(|item| succeeded(item)) {
                errors.extend(item.undo());
            }
            errors.extend(snapshot.restore(state));
            return Err(recovery_error(persist_error, errors));
        }
    }

    Ok(ArchiveSkillsResult { archived, failed })
}

struct PreparedRestore {
    archive_id: String,
    archived_skill: ArchivedSkill,
    owner: ArchiveOwner,
    archive_dir: PathBuf,
    restore_path: PathBuf,
    restored_agents: Vec<String>,
    moved: bool,
    scanned: Option<SkillCacheEntry>,
    expected_id: String,
}

impl PreparedRestore {
    fn undo(&self) -> Vec<String> {
        let mut errors = Vec::new();
        for agent in &self.restored_agents {
            if let Err(e) = SkillService::toggle_symlink(
                &self.archived_skill.directory,
                &self.restore_path.to_string_lossy(),
                agent,
                false,
            ) {
                errors.push(format!("remove restored agent symlink: {e}"));
            }
        }
        if self.moved && self.restore_path.exists() && !self.archive_dir.exists() {
            if let Some(parent) = self.archive_dir.parent() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    errors.push(format!("recreate archive parent: {e}"));
                }
            }
            if let Err(e) = std::fs::rename(&self.restore_path, &self.archive_dir) {
                errors.push(format!("move restored skill back to archive: {e}"));
            }
        }
        errors
    }
}

fn prepare_restore(
    write: &ArchiveWrite<'_>,
    manifest: &ArchiveManifest,
    archive_id: String,
) -> Result<PreparedRestore, String> {
    validate_archive_id(&archive_id)?;
    let archived_skill = manifest
        .skills
        .get(&archive_id)
        .cloned()
        .ok_or_else(|| format!("Archived skill not found: {archive_id}"))?;

    if !matches!(archived_skill.origin.as_str(), "ssot" | "agent") {
        return Err(format!(
            "Unsupported archive ownership '{}'. The archive and original source were preserved.",
            archived_skill.origin
        ));
    }
    let owner = ArchiveOwner::resolve(
        &archived_skill.origin,
        archived_skill.home_agent.as_deref(),
        &archived_skill.name,
        None,
    )?;
    let archive_dir = ArchiveManifest::archive_skill_dir(&archive_id);
    if !archive_dir.is_dir()
        || is_symlink_or_junction(&archive_dir)
        || !archive_dir.join("SKILL.md").is_file()
    {
        return Err(format!(
            "Archived skill directory is missing or invalid: {}. The archive entry was preserved.",
            archive_dir.display()
        ));
    }
    let restore_path = match &archived_skill.home_path {
        Some(home) => PathBuf::from(home),
        None if matches!(owner, ArchiveOwner::Store) => {
            config::get_agents_skills_dir().join(&archived_skill.directory)
        }
        None => {
            return Err("Archive does not record the original agent home. The archive was preserved; restore its files manually rather than guessing a destination.".into())
        }
    };
    if restore_path.exists() {
        return Err(format!("Cannot restore: destination already exists at {}. Move, rename, archive, or remove the existing skill folder before restoring this archived skill.", restore_path.display()));
    }
    let expected_id = if write
        .imports
        .imports
        .contains_key(&archived_skill.original_skill_id)
    {
        archived_skill.original_skill_id.clone()
    } else {
        crate::persistence::metadata::canonicalize_legacy_skill_id(
            &archived_skill.original_skill_id,
        )
        .unwrap_or_else(|| archived_skill.original_skill_id.clone())
    };

    Ok(PreparedRestore {
        archive_id,
        archived_skill,
        owner,
        archive_dir,
        restore_path,
        restored_agents: Vec::new(),
        moved: false,
        scanned: None,
        expected_id,
    })
}

pub async fn restore_archived_skills(
    state: &AppState,
    archive_ids: Vec<String>,
) -> Result<RestoreArchivedSkillsResult, String> {
    let write = ArchiveWrite::begin(state).await?;
    let mut restored: Vec<RestoredArchivedSkill> = Vec::new();
    let mut failed: Vec<RestoreArchivedSkillFailure> = Vec::new();

    let manifest = ArchiveManifest::load().map_err(|e| e.to_string())?;
    let mut manifest_after = manifest.clone();
    let mut prepared: Vec<PreparedRestore> = Vec::new();
    for archive_id in archive_ids {
        match prepare_restore(&write, &manifest, archive_id.clone()) {
            Ok(item) => prepared.push(item),
            Err(e) => failed.push(RestoreArchivedSkillFailure {
                archive_id,
                error: e,
            }),
        }
    }
    if prepared.is_empty() {
        let skipped_agents = compute_skipped_agents(&manifest, &restored);
        return Ok(RestoreArchivedSkillsResult {
            restored,
            failed,
            skipped_agents,
        });
    }

    let snapshot = ArchiveSnapshot::capture(state)?;

    for item in &mut prepared {
        let mut item_error: Option<String> = None;
        if let Some(parent) = item.restore_path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                item_error = Some(format_archive_io_error(
                    "Create restore directory",
                    parent,
                    &e,
                ));
            }
        }
        if item_error.is_none() {
            match std::fs::rename(&item.archive_dir, &item.restore_path) {
                Ok(()) => item.moved = true,
                Err(e) => {
                    item_error = Some(format_archive_io_error(
                        "Move archived skill back",
                        &item.restore_path,
                        &e,
                    ));
                }
            }
        }

        if item_error.is_none() {
            for (agent, enabled) in &item.archived_skill.apps {
                if !enabled {
                    continue;
                }
                let Some(agent_dir) = config::get_agent_skills_dir(agent) else {
                    continue;
                };
                if !agent_dir.exists() {
                    continue;
                }
                let agent_skill_path = agent_dir.join(SkillService::agent_link_name(
                    &item.archived_skill.directory,
                ));
                if item.archived_skill.home_agent.as_deref() == Some(agent.as_str())
                    && agent_skill_path != item.restore_path
                {
                    continue;
                }
                if agent_skill_path.exists() && !is_symlink_or_junction(&agent_skill_path) {
                    let is_native_home = agent_skill_path == item.restore_path
                        || agent_skill_path
                            .canonicalize()
                            .ok()
                            .zip(item.restore_path.canonicalize().ok())
                            .is_some_and(|(agent_path, restore_path)| agent_path == restore_path);
                    if is_native_home {
                        continue;
                    }
                    item_error = Some(format!(
                        "Restore agent link failed: destination already exists at {} and is a real directory, not a symlink.",
                        agent_skill_path.display()
                    ));
                    break;
                }
                match SkillService::toggle_symlink(
                    &item.archived_skill.directory,
                    &item.restore_path.to_string_lossy(),
                    agent,
                    true,
                ) {
                    Ok(()) => item.restored_agents.push(agent.clone()),
                    Err(e) => {
                        item_error = Some(format_archive_app_error("Restore agent link", e));
                        break;
                    }
                }
            }
        }

        if item_error.is_none() {
            let entry = if let Some(import) = write
                .imports
                .imports
                .get(&item.archived_skill.original_skill_id)
            {
                SkillService::scan_external_import(import, None).map_err(|e| e.to_string())
            } else {
                item.owner.scan(&item.restore_path)
            };
            match entry {
                Ok(entry) if entry.id == item.expected_id => item.scanned = Some(entry),
                Ok(entry) => {
                    item_error = Some(format!(
                        "Restored home does not match the recorded skill identity ({} != {}). The archive was preserved.",
                        entry.id, item.expected_id
                    ));
                }
                Err(e) => item_error = Some(e),
            }
        }

        if let Some(message) = item_error {
            let undo_errors = item.undo();
            let error = if undo_errors.is_empty() {
                message
            } else {
                recovery_error(message, undo_errors)
            };
            failed.push(RestoreArchivedSkillFailure {
                archive_id: item.archive_id.clone(),
                error,
            });
            continue;
        }
        manifest_after.skills.remove(&item.archive_id);
    }

    let completed: Vec<&PreparedRestore> = prepared
        .iter()
        .filter(|item| item.scanned.is_some())
        .collect();
    if completed.is_empty() {
        let skipped_agents = compute_skipped_agents(&manifest, &restored);
        return Ok(RestoreArchivedSkillsResult {
            restored,
            failed,
            skipped_agents,
        });
    }
    let persist = (|| -> Result<(), String> {
        let lock_inserts: Vec<(String, SkillLockEntry)> = completed
            .iter()
            .filter_map(|item| {
                if !matches!(item.owner, ArchiveOwner::Store) {
                    return None;
                }
                let lock_entry = item.archived_skill.lock_entry.clone()?;
                let key = item
                    .archived_skill
                    .lock_key
                    .clone()
                    .unwrap_or_else(|| item.archived_skill.directory.clone());
                Some((key, lock_entry))
            })
            .collect();
        if !lock_inserts.is_empty() {
            SkillLock::update(|lock| {
                for (key, entry) in lock_inserts {
                    lock.skills.insert(key, entry);
                }
                Ok::<(), AppError>(())
            })
            .map_err(|e| e.to_string())?;
        }

        let mut metadata = state.metadata.write().map_err(|e| e.to_string())?;
        for item in &completed {
            let archived_skill = &item.archived_skill;
            let metadata_key = crate::persistence::metadata::canonicalize_legacy_skill_id(
                &archived_skill.original_skill_id,
            )
            .unwrap_or_else(|| archived_skill.original_skill_id.clone());
            if archived_skill.starred || archived_skill.is_mine {
                let entry = metadata.entries.entry(metadata_key).or_insert(
                    crate::persistence::metadata::SkillMetadata {
                        starred: false,
                        is_mine: false,
                    },
                );
                entry.starred = entry.starred || archived_skill.starred;
                entry.is_mine = entry.is_mine || archived_skill.is_mine;
            } else {
                metadata.remove(&metadata_key);
            }
        }
        metadata.save().map_err(|e| e.to_string())?;
        drop(metadata);

        let entries: Vec<SkillCacheEntry> = completed
            .iter()
            .filter_map(|item| item.scanned.clone())
            .collect();
        SkillService::upsert_cache_entries(&state.skill_cache, entries)
            .map_err(|e| e.to_string())?;

        manifest_after.save().map_err(|e| e.to_string())?;
        Ok(())
    })();

    if let Err(persist_error) = persist {
        let mut errors = Vec::new();
        for item in &completed {
            errors.extend(item.undo());
        }
        errors.extend(snapshot.restore(state));
        return Err(recovery_error(persist_error, errors));
    }

    let installed_by_id: HashMap<String, InstalledSkill> =
        SkillService::read_all_skills(&state.skill_cache, &state.metadata)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|skill| (skill.id.clone(), skill))
            .collect();
    for item in &completed {
        let restored_id = item
            .scanned
            .as_ref()
            .map(|entry| entry.id.clone())
            .unwrap_or_else(|| item.expected_id.clone());
        match installed_by_id.get(&restored_id).cloned() {
            Some(skill) => restored.push(RestoredArchivedSkill {
                archive_id: item.archive_id.clone(),
                skill,
            }),
            None => failed.push(RestoreArchivedSkillFailure {
                archive_id: item.archive_id.clone(),
                error: "Skill restored but not found in cache".to_string(),
            }),
        }
    }

    let skipped_agents = compute_skipped_agents(&manifest, &restored);
    Ok(RestoreArchivedSkillsResult {
        restored,
        failed,
        skipped_agents,
    })
}

fn compute_skipped_agents(
    manifest: &ArchiveManifest,
    restored: &[RestoredArchivedSkill],
) -> Vec<String> {
    let mut skipped_agents = restored
        .iter()
        .map(|record| &record.archive_id)
        .filter_map(|id| manifest.skills.get(id))
        .flat_map(|s| s.apps.iter())
        .filter(|(agent, enabled)| {
            **enabled && config::get_agent_skills_dir(agent).is_none_or(|p| !p.exists())
        })
        .map(|(agent, _)| agent.clone())
        .collect::<Vec<_>>();
    skipped_agents.sort();
    skipped_agents.dedup();
    skipped_agents
}

fn assert_writable_schema(lock: &SkillLock, manifest: &ArchiveManifest) -> Result<(), String> {
    if lock.version > SUPPORTED_LOCK_VERSION {
        return Err(format!(
            "Lock file version {0} is newer than this desktop app supports. Upgrade Skill Zoo before writing.",
            lock.version
        ));
    }
    if manifest.version > SUPPORTED_ARCHIVE_VERSION {
        return Err(format!(
            "Archive manifest version {0} is newer than this desktop app supports. Upgrade Skill Zoo before writing.",
            manifest.version
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::SkillCacheEntry;
    use crate::services::lock::SkillLockEntry;
    use serde::Deserialize;

    fn archive_one(state: &AppState, id: String) -> Result<(), String> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = rt.block_on(archive_skills(state, vec![id]))?;
        if let Some(failure) = result.failed.into_iter().next() {
            Err(failure.error)
        } else {
            Ok(())
        }
    }

    fn restore_one(state: &AppState, id: String) -> Result<String, String> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = rt.block_on(restore_archived_skills(state, vec![id]))?;
        if let Some(failure) = result.failed.into_iter().next() {
            return Err(failure.error);
        }
        Ok(result.restored.into_iter().next().unwrap().skill.id)
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ArchiveRoundtripCase {
        name: String,
        origin: String,
        directory: String,
        coexisting_store: bool,
        #[serde(default)]
        historical_lock: bool,
    }

    fn archive_roundtrip_cases() -> Vec<ArchiveRoundtripCase> {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../fixtures/local-protocol/archive-roundtrip-cases.json"
        )))
        .unwrap()
    }

    #[test]
    fn unsupported_archives_preserve_records_archive_files_and_external_sources() {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Case {
            name: String,
            origin: String,
            missing_home: bool,
        }
        let cases: Vec<Case> = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../fixtures/local-protocol/archive-unsupported-cases.json"
        )))
        .unwrap();
        for case in cases {
            let tmp = tempfile::tempdir().unwrap();
            config::with_test_home(tmp.path(), || {
                let (state, entry) = archive_fixture(&archive_roundtrip_cases().remove(1));
                archive_one(&state, entry.id.clone()).unwrap();
                let id = ArchiveManifest::make_archive_id(&entry.id, &entry.directory);
                let external = tmp.path().join("private/source");
                std::fs::create_dir_all(&external).unwrap();
                std::fs::write(external.join("SKILL.md"), "# Keep external source").unwrap();
                let mut manifest = ArchiveManifest::load().unwrap();
                let record = manifest.skills.get_mut(&id).unwrap();
                record.origin = case.origin;
                record.home_path =
                    (!case.missing_home).then(|| external.to_string_lossy().into_owned());
                manifest.save().unwrap();
                assert!(restore_one(&state, id.clone()).is_err(), "{}", case.name);
                assert_eq!(
                    std::fs::read_to_string(
                        ArchiveManifest::archive_skill_dir(&id).join("SKILL.md")
                    )
                    .unwrap(),
                    "# Selected skill",
                    "{}",
                    case.name
                );
                assert_eq!(
                    std::fs::read_to_string(external.join("SKILL.md")).unwrap(),
                    "# Keep external source"
                );
                assert!(ArchiveManifest::load().unwrap().skills.contains_key(&id));
            });
        }
    }

    #[test]
    fn restore_refuses_when_the_archived_skill_md_is_missing_and_preserves_the_record() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let (state, entry) = archive_fixture(&archive_roundtrip_cases().remove(0));
            archive_one(&state, entry.id.clone()).unwrap();
            let id = ArchiveManifest::make_archive_id(&entry.id, &entry.directory);
            let archive_dir = ArchiveManifest::archive_skill_dir(&id);
            std::fs::remove_file(archive_dir.join("SKILL.md")).unwrap();

            let error = restore_one(&state, id.clone()).unwrap_err();
            assert!(error.contains("missing or invalid"), "{error}");
            assert!(error.contains("The archive entry was preserved"), "{error}");
            assert!(ArchiveManifest::load().unwrap().skills.contains_key(&id));
            assert!(archive_dir.is_dir());
            assert!(!Path::new(entry.home_path.as_ref().unwrap()).exists());
            drop(AgentLease::acquire(&config::get_app_config_dir()).unwrap());
        });
    }

    #[test]
    fn restore_identity_mismatch_rolls_back_to_a_preserved_archive() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let (state, entry) = archive_fixture(&archive_roundtrip_cases().remove(0));
            archive_one(&state, entry.id.clone()).unwrap();
            let id = ArchiveManifest::make_archive_id(&entry.id, &entry.directory);
            let archive_dir = ArchiveManifest::archive_skill_dir(&id);
            let mut manifest = ArchiveManifest::load().unwrap();
            let record = manifest.skills.get_mut(&id).unwrap();
            record.original_skill_id = "ssot:old-name".into();
            manifest.save().unwrap();

            let error = restore_one(&state, id.clone()).unwrap_err();
            assert!(
                error.contains("Restored home does not match the recorded skill identity"),
                "{error}"
            );

            assert!(ArchiveManifest::load().unwrap().skills.contains_key(&id));
            assert_eq!(
                std::fs::read_to_string(archive_dir.join("SKILL.md")).unwrap(),
                "# Selected skill"
            );
            assert!(!Path::new(entry.home_path.as_ref().unwrap()).exists());
            let metadata = state.metadata.read().unwrap();
            assert!(metadata.get("ssot:old-name").starred == false);
            assert!(
                ArchiveManifest::load()
                    .unwrap()
                    .skills
                    .get(&id)
                    .unwrap()
                    .starred
            );
            drop(AgentLease::acquire(&config::get_app_config_dir()).unwrap());
        });
    }

    #[test]
    fn archive_target_rejects_a_stale_home_that_no_longer_contains_a_skill() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let (state, entry) = archive_fixture(&archive_roundtrip_cases().remove(0));
            let home = PathBuf::from(entry.home_path.as_ref().unwrap());
            std::fs::remove_file(home.join("SKILL.md")).unwrap();
            std::fs::write(home.join("personal.txt"), "Keep this directory").unwrap();
            assert!(archive_one(&state, entry.id.clone()).is_err());
            assert_eq!(
                std::fs::read_to_string(home.join("personal.txt")).unwrap(),
                "Keep this directory"
            );
            assert!(!config::get_archive_manifest_file().exists());
        });
    }

    #[test]
    fn archive_target_rejects_a_retained_import_even_when_its_cached_origin_is_agent() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let (state, entry) = archive_fixture(&archive_roundtrip_cases().remove(1));
            let mut imports = ExternalImports::default();
            imports.imports.insert(
                entry.id.clone(),
                crate::persistence::ExternalImportEntry {
                    extra: Default::default(),
                    id: entry.id.clone(),
                    directory: entry.directory.clone(),
                    source_path: entry.home_path.clone().unwrap(),
                    imported_at: 1,
                    updated_at: 1,
                },
            );
            imports.save().unwrap();
            let error = archive_one(&state, entry.id.clone()).unwrap_err();
            assert!(error.contains("External imports cannot be archived"));
            assert!(Path::new(entry.home_path.as_ref().unwrap())
                .join("SKILL.md")
                .exists());
            assert!(!config::get_archive_manifest_file().exists());
        });
    }

    #[test]
    fn archive_target_rejects_a_home_outside_the_recorded_owner() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let (state, mut entry) = archive_fixture(&archive_roundtrip_cases().remove(0));
            let outside = tmp.path().join("private/demo");
            std::fs::create_dir_all(&outside).unwrap();
            std::fs::write(outside.join("SKILL.md"), "# User-owned skill").unwrap();
            entry.home_path = Some(outside.to_string_lossy().into_owned());
            state.skill_cache.write().unwrap().upsert(entry.clone());
            assert!(archive_one(&state, entry.id).is_err());
            assert_eq!(
                std::fs::read_to_string(outside.join("SKILL.md")).unwrap(),
                "# User-owned skill"
            );
            assert!(!config::get_archive_manifest_file().exists());
        });
    }

    #[test]
    fn unreadable_or_future_import_registry_blocks_mutations_before_moving_files() {
        for content in ["invalid json", "{\"version\":2,\"imports\":{}}"] {
            let tmp = tempfile::tempdir().unwrap();
            config::with_test_home(tmp.path(), || {
                let (state, entry) = archive_fixture(&archive_roundtrip_cases().remove(0));
                std::fs::write(config::get_external_imports_file(), content).unwrap();
                assert!(archive_one(&state, entry.id).is_err());
                assert!(Path::new(entry.home_path.as_ref().unwrap())
                    .join("SKILL.md")
                    .exists());
                assert_eq!(
                    std::fs::read_to_string(config::get_external_imports_file()).unwrap(),
                    content
                );
                assert!(!config::get_archive_manifest_file().exists());
                drop(AgentLease::acquire(&config::get_app_config_dir()).unwrap());
            });
        }
    }

    #[test]
    fn archive_and_restore_wait_for_refresh_and_release_the_lease_on_cancellation() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let (state, entry) = archive_fixture(&archive_roundtrip_cases().remove(0));
            let home = PathBuf::from(entry.home_path.as_ref().unwrap());
            let archive_id = ArchiveManifest::make_archive_id(&entry.id, &entry.directory);
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            rt.block_on(async {
                let guard = state.cache_refresh_lock.lock().await;
                assert!(tokio::time::timeout(
                    std::time::Duration::from_millis(20),
                    archive_skills(&state, vec![entry.id.clone()])
                )
                .await
                .is_err());
                assert!(home.join("SKILL.md").exists());
                drop(
                    AgentLease::acquire(&config::get_app_config_dir())
                        .expect("cancelled archive must release its lease"),
                );
                drop(guard);
                assert!(archive_skills(&state, vec![entry.id.clone()])
                    .await
                    .unwrap()
                    .failed
                    .is_empty());

                let guard = state.cache_refresh_lock.lock().await;
                assert!(tokio::time::timeout(
                    std::time::Duration::from_millis(20),
                    restore_archived_skills(&state, vec![archive_id.clone()])
                )
                .await
                .is_err());
                assert!(!home.exists());
                assert!(ArchiveManifest::archive_skill_dir(&archive_id)
                    .join("SKILL.md")
                    .exists());
                drop(
                    AgentLease::acquire(&config::get_app_config_dir())
                        .expect("cancelled restore must release its lease"),
                );
                drop(guard);
                let restored = restore_archived_skills(&state, vec![archive_id])
                    .await
                    .unwrap();
                assert!(restored.failed.is_empty());
                assert_eq!(restored.restored[0].skill.id, entry.id);
            });
        });
    }

    #[test]
    fn persistence_failures_restore_files_and_memory_without_holding_state_locks() {
        for restoring in [false, true] {
            for file in ["skills-cache.json", "metadata.json", "lock", "manifest"] {
                let tmp = tempfile::tempdir().unwrap();
                config::with_test_home(tmp.path(), || {
                    let (state, entry) = archive_fixture(&archive_roundtrip_cases().remove(0));
                    let mut lock = SkillLock::read().unwrap();
                    lock.skills.insert(
                        entry.directory.clone(),
                        test_lock_entry("original/repo", "sha"),
                    );
                    lock.write().unwrap();
                    let home = PathBuf::from(entry.home_path.as_ref().unwrap());
                    let archive_id = ArchiveManifest::make_archive_id(&entry.id, &entry.directory);
                    if restoring {
                        archive_one(&state, entry.id.clone()).unwrap();
                    }
                    let manifest_before =
                        serde_json::to_value(ArchiveManifest::load().unwrap()).unwrap();
                    let metadata_before =
                        serde_json::to_value(MetadataStore::load().unwrap()).unwrap();
                    let lock_before = serde_json::to_value(SkillLock::read().unwrap()).unwrap();
                    let destination = match file {
                        "lock" => config::get_agent_lock_file(),
                        "manifest" => config::get_archive_manifest_file(),
                        _ => config::get_app_config_dir().join(file),
                    };
                    std::fs::create_dir_all(destination.with_file_name(format!(
                        "{}.tmp",
                        destination.file_name().unwrap().to_string_lossy()
                    )))
                    .unwrap();

                    let error = if restoring {
                        restore_one(&state, archive_id.clone()).unwrap_err()
                    } else {
                        archive_one(&state, entry.id.clone()).unwrap_err()
                    };
                    if restoring || file != "manifest" {
                        assert!(error.contains("Recovery incomplete"), "{error}");
                    }
                    assert_eq!(home.exists(), !restoring);
                    assert_eq!(
                        ArchiveManifest::archive_skill_dir(&archive_id).exists(),
                        restoring
                    );
                    assert_eq!(
                        state
                            .skill_cache
                            .read()
                            .unwrap()
                            .find_by_id(&entry.id)
                            .is_some(),
                        !restoring
                    );
                    assert_eq!(
                        serde_json::to_value(ArchiveManifest::load().unwrap()).unwrap(),
                        manifest_before
                    );
                    assert_eq!(
                        serde_json::to_value(MetadataStore::load().unwrap()).unwrap(),
                        metadata_before
                    );
                    assert_eq!(
                        serde_json::to_value(SkillLock::read().unwrap()).unwrap(),
                        lock_before
                    );
                    assert_eq!(
                        state.metadata.read().unwrap().get(&entry.id).starred,
                        !restoring
                    );
                });
            }
        }
    }

    #[test]
    fn failed_restore_preserves_a_preexisting_lock_record_and_unknown_fields() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let (state, entry) = archive_fixture(&archive_roundtrip_cases().remove(0));
            let mut lock = SkillLock::read().unwrap();
            lock.skills.insert(
                entry.directory.clone(),
                test_lock_entry("original/repo", "old"),
            );
            lock.write().unwrap();
            archive_one(&state, entry.id.clone()).unwrap();
            let mut lock = SkillLock::read().unwrap();
            let mut independent = test_lock_entry("independent/repo", "new");
            independent
                .extra
                .insert("futureOptional".into(), serde_json::json!("keep"));
            lock.extra
                .insert("futureTop".into(), serde_json::json!("keep"));
            lock.skills.insert(entry.directory.clone(), independent);
            lock.write().unwrap();
            let before = serde_json::to_value(&lock).unwrap();
            std::fs::create_dir_all(config::get_app_config_dir().join("metadata.json.tmp"))
                .unwrap();

            let archive_id = ArchiveManifest::make_archive_id(&entry.id, &entry.directory);
            assert!(restore_one(&state, archive_id.clone()).is_err());
            assert_eq!(
                serde_json::to_value(SkillLock::read().unwrap()).unwrap(),
                before
            );
            assert!(ArchiveManifest::archive_skill_dir(&archive_id)
                .join("SKILL.md")
                .exists());
        });
    }

    #[test]
    fn restore_link_conflict_preserves_the_foreign_directory_and_archived_source() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let (state, entry) = archive_fixture(&archive_roundtrip_cases().remove(0));
            let home = entry.home_path.as_ref().unwrap();
            SkillService::toggle_symlink(&entry.directory, home, "codex", true).unwrap();
            let current = SkillService::scan_skill_root(
                Path::new(home),
                &config::get_agents_skills_dir(),
                None,
                None,
            )
            .unwrap();
            state.skill_cache.write().unwrap().upsert(current);
            archive_one(&state, entry.id.clone()).unwrap();
            let occupied = config::get_agent_skills_dir("codex").unwrap().join("demo");
            std::fs::create_dir_all(&occupied).unwrap();
            std::fs::write(occupied.join("SKILL.md"), "# Foreign files").unwrap();
            let archive_id = ArchiveManifest::make_archive_id(&entry.id, &entry.directory);

            let error = restore_one(&state, archive_id.clone()).unwrap_err();
            assert!(error.contains("real directory"), "{error}");
            assert_eq!(
                std::fs::read_to_string(occupied.join("SKILL.md")).unwrap(),
                "# Foreign files"
            );
            assert_eq!(
                std::fs::read_to_string(
                    ArchiveManifest::archive_skill_dir(&archive_id).join("SKILL.md")
                )
                .unwrap(),
                "# Selected skill"
            );
            assert!(!Path::new(home).exists());
            assert!(state
                .skill_cache
                .read()
                .unwrap()
                .find_by_id(&entry.id)
                .is_none());
        });
    }

    fn batch_archive_fixture() -> (AppState, Vec<SkillCacheEntry>) {
        let store = config::get_agents_skills_dir();
        let agent = config::get_agent_skills_dir("codex").unwrap();
        let mut entries = Vec::new();
        for name in ["demo-a", "demo-b"] {
            let home = store.join(name);
            std::fs::create_dir_all(&home).unwrap();
            std::fs::write(home.join("SKILL.md"), format!("# {name}")).unwrap();
            SkillService::toggle_symlink(name, home.to_string_lossy().as_ref(), "codex", true)
                .unwrap();
            entries.push(SkillService::scan_skill_root(&home, &store, None, None).unwrap());
        }
        let mut metadata = crate::persistence::MetadataStore {
            entries: Default::default(),
        };
        let mut lock = SkillLock::read().unwrap();
        for entry in &entries {
            metadata.set_starred(&entry.id, true);
            lock.skills.insert(
                entry.directory.clone(),
                test_lock_entry("owner/repo", "sha"),
            );
        }
        metadata.save().unwrap();
        lock.write().unwrap();
        (
            AppState::new(
                SkillCache::from_entries(entries.clone()),
                crate::persistence::MetadataStore {
                    entries: Default::default(),
                },
                crate::persistence::Settings {
                    values: Default::default(),
                },
            ),
            entries,
        )
    }

    #[cfg(unix)]
    #[test]
    fn archive_skills_batch_keeps_state_files_when_every_move_fails() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let (state, entries) = batch_archive_fixture();
            let lock_before = serde_json::to_value(SkillLock::read().unwrap()).unwrap();
            let metadata_before = serde_json::to_value(MetadataStore::load().unwrap()).unwrap();

            let probe = &entries[0];
            let probe_archive_id = ArchiveManifest::make_archive_id(&probe.id, &probe.directory);
            let archive_root = ArchiveManifest::archive_skill_dir(&probe_archive_id)
                .parent()
                .unwrap()
                .to_path_buf();
            std::fs::create_dir_all(&archive_root).unwrap();
            std::fs::set_permissions(&archive_root, std::fs::Permissions::from_mode(0o555))
                .unwrap();

            let ids: Vec<String> = entries.iter().map(|entry| entry.id.clone()).collect();
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            let result = rt.block_on(archive_skills(&state, ids)).unwrap();
            std::fs::set_permissions(&archive_root, std::fs::Permissions::from_mode(0o755))
                .unwrap();

            assert!(result.archived.is_empty());
            assert_eq!(result.failed.len(), entries.len());
            for entry in &entries {
                let home = PathBuf::from(entry.home_path.as_ref().unwrap());
                assert!(home.join("SKILL.md").is_file());
                let codex_link = config::get_agent_skills_dir("codex")
                    .unwrap()
                    .join(SkillService::agent_link_name(&entry.directory));
                assert!(codex_link.symlink_metadata().is_ok());
                assert!(state
                    .skill_cache
                    .read()
                    .unwrap()
                    .find_by_id(&entry.id)
                    .is_some());
                assert!(SkillLock::read()
                    .unwrap()
                    .skills
                    .contains_key(&entry.directory));
                assert!(state.metadata.read().unwrap().get(&entry.id).starred);
            }
            assert_eq!(
                serde_json::to_value(SkillLock::read().unwrap()).unwrap(),
                lock_before
            );
            assert_eq!(
                serde_json::to_value(MetadataStore::load().unwrap()).unwrap(),
                metadata_before
            );
            assert!(ArchiveManifest::load().unwrap().skills.is_empty());
            drop(
                crate::persistence::agent_transaction::AgentLease::acquire(
                    &config::get_app_config_dir(),
                )
                .unwrap(),
            );
        });
    }

    #[test]
    fn archive_skills_batch_reports_partial_failures_and_persists_survivors() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let (state, entries) = batch_archive_fixture();
            let mut missing = entries[0].clone();
            missing.id = "ssot:demo-missing".into();
            missing.directory = "demo-missing".into();
            missing.home_path = Some(
                config::get_agents_skills_dir()
                    .join("demo-missing")
                    .to_string_lossy()
                    .into_owned(),
            );
            state.skill_cache.write().unwrap().upsert(missing.clone());

            let ids: Vec<String> = entries
                .iter()
                .chain(std::iter::once(&missing))
                .map(|entry| entry.id.clone())
                .collect();
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            let result = rt.block_on(archive_skills(&state, ids)).unwrap();

            assert_eq!(result.failed.len(), 1);
            assert_eq!(result.failed[0].skill_id, missing.id);
            assert!(result.failed[0].error.contains("archiveable"));
            let mut archived = result.archived.clone();
            archived.sort();
            let mut expected: Vec<String> = entries.iter().map(|e| e.id.clone()).collect();
            expected.sort();
            assert_eq!(archived, expected);

            let manifest = ArchiveManifest::load().unwrap();
            let lock = SkillLock::read().unwrap();
            let codex_dir = config::get_agent_skills_dir("codex").unwrap();
            for entry in &entries {
                let home = PathBuf::from(entry.home_path.as_ref().unwrap());
                assert!(
                    !home.exists(),
                    "{} home must move into the archive",
                    entry.id
                );
                let archive_id = ArchiveManifest::make_archive_id(&entry.id, &entry.directory);
                assert!(ArchiveManifest::archive_skill_dir(&archive_id)
                    .join("SKILL.md")
                    .is_file());
                assert!(manifest.skills.contains_key(&archive_id));
                assert!(!lock.skills.contains_key(&entry.directory));
                let link = codex_dir.join(SkillService::agent_link_name(&entry.directory));
                assert!(!link.symlink_metadata().is_ok());
                assert!(state
                    .skill_cache
                    .read()
                    .unwrap()
                    .find_by_id(&entry.id)
                    .is_none());
                assert!(!state.metadata.read().unwrap().get(&entry.id).starred);
            }
            assert!(state
                .skill_cache
                .read()
                .unwrap()
                .find_by_id(&missing.id)
                .is_some());
            drop(
                crate::persistence::agent_transaction::AgentLease::acquire(
                    &config::get_app_config_dir(),
                )
                .unwrap(),
            );
        });
    }

    #[test]
    fn restore_archived_skills_batch_reports_partial_failures() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let (state, entries) = batch_archive_fixture();
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            let ids: Vec<String> = entries.iter().map(|entry| entry.id.clone()).collect();
            let archived = rt.block_on(archive_skills(&state, ids)).unwrap();
            assert!(archived.failed.is_empty(), "{:?}", archived.failed);

            let blocked_home = config::get_agents_skills_dir().join("demo-b");
            std::fs::create_dir_all(&blocked_home).unwrap();
            std::fs::write(blocked_home.join("SKILL.md"), "# foreign").unwrap();

            let archive_ids: Vec<String> = entries
                .iter()
                .map(|entry| ArchiveManifest::make_archive_id(&entry.id, &entry.directory))
                .collect();
            let result = rt
                .block_on(restore_archived_skills(&state, archive_ids.clone()))
                .unwrap();

            assert_eq!(result.failed.len(), 1);
            assert!(result.failed[0]
                .error
                .contains("destination already exists"));
            assert_eq!(result.restored.len(), 1);
            assert_eq!(result.restored[0].skill.id, entries[0].id);

            let first_home = PathBuf::from(entries[0].home_path.as_ref().unwrap());
            assert!(first_home.join("SKILL.md").is_file());
            let codex_dir = config::get_agent_skills_dir("codex").unwrap();
            assert!(codex_dir
                .join(SkillService::agent_link_name("demo-a"))
                .symlink_metadata()
                .is_ok());
            assert!(state
                .skill_cache
                .read()
                .unwrap()
                .find_by_id(&entries[0].id)
                .is_some());
            assert!(state.metadata.read().unwrap().get(&entries[0].id).starred);
            assert!(SkillLock::read().unwrap().skills.contains_key("demo-a"));

            assert_eq!(
                std::fs::read_to_string(blocked_home.join("SKILL.md")).unwrap(),
                "# foreign"
            );
            assert!(ArchiveManifest::archive_skill_dir(&archive_ids[1])
                .join("SKILL.md")
                .is_file());
            let manifest = ArchiveManifest::load().unwrap();
            assert!(manifest.skills.contains_key(&archive_ids[1]));
            assert!(!manifest.skills.contains_key(&archive_ids[0]));
            assert!(!SkillLock::read().unwrap().skills.contains_key("demo-b"));

            drop(
                crate::persistence::agent_transaction::AgentLease::acquire(
                    &config::get_app_config_dir(),
                )
                .unwrap(),
            );
        });
    }

    fn archive_fixture(case: &ArchiveRoundtripCase) -> (AppState, SkillCacheEntry) {
        let store = config::get_agents_skills_dir();
        let agent = config::get_agent_skills_dir("codex").unwrap();
        let root = if case.origin == "ssot" {
            &store
        } else {
            &agent
        };
        let home = root.join(&case.directory);
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(home.join("SKILL.md"), "# Selected skill").unwrap();
        let agent = (case.origin == "agent").then_some("codex");
        let entry = SkillService::scan_skill_root(&home, root, agent, None).unwrap();
        let mut entries = vec![entry.clone()];
        if case.coexisting_store {
            let peer = store.join(&case.directory);
            std::fs::create_dir_all(&peer).unwrap();
            std::fs::write(peer.join("SKILL.md"), "# Independent store skill").unwrap();
            entries.push(SkillService::scan_skill_root(&peer, &store, None, None).unwrap());
        }
        let mut metadata = crate::persistence::MetadataStore {
            entries: Default::default(),
        };
        metadata.set_starred(&entry.id, true);
        metadata.set_is_mine(&entry.id, true);
        metadata.save().unwrap();
        (
            AppState::new(
                SkillCache::from_entries(entries),
                metadata,
                crate::persistence::Settings {
                    values: Default::default(),
                },
            ),
            entry,
        )
    }

    #[test]
    fn archive_roundtrip_preserves_the_selected_physical_identity() {
        for case in archive_roundtrip_cases() {
            let tmp = tempfile::tempdir().unwrap();
            config::with_test_home(tmp.path(), || {
                let (state, entry) = archive_fixture(&case);
                let mut lock = SkillLock::read().unwrap();
                if case.coexisting_store {
                    lock.skills.insert(
                        case.directory.clone(),
                        test_lock_entry("independent/repo", "sha"),
                    );
                    lock.write().unwrap();
                }
                let lock_before = serde_json::to_value(&lock).unwrap();
                let flat = config::get_agent_skills_dir("codex")
                    .map(|root| root.join(SkillService::agent_link_name(&case.directory)));
                let flat_before = flat.as_ref().is_some_and(|p| p.symlink_metadata().is_ok());
                archive_one(&state, entry.id.clone()).unwrap();
                let id = ArchiveManifest::make_archive_id(&entry.id, &entry.directory);
                if case.historical_lock {
                    let mut manifest = ArchiveManifest::load().unwrap();
                    let record = manifest.skills.get_mut(&id).unwrap();
                    record.lock_key = Some(case.directory.clone());
                    record.lock_entry = Some(test_lock_entry("historical/repo", "old"));
                    manifest.save().unwrap();
                }
                let restored = restore_one(&state, id).unwrap();
                assert_eq!(restored, entry.id, "{}", case.name);
                assert_eq!(
                    serde_json::to_value(SkillLock::read().unwrap()).unwrap(),
                    lock_before,
                    "{}",
                    case.name
                );
                assert_eq!(
                    std::fs::read_to_string(
                        Path::new(entry.home_path.as_ref().unwrap()).join("SKILL.md")
                    )
                    .unwrap(),
                    "# Selected skill"
                );
                let metadata = state.metadata.read().unwrap();
                assert!(metadata.get(&entry.id).starred && metadata.get(&entry.id).is_mine);
                let flat_after = flat.as_ref().is_some_and(|p| p.symlink_metadata().is_ok());
                assert_eq!(flat_after, flat_before, "{}", case.name);
            });
        }
    }

    #[test]
    fn archiving_an_agent_does_not_take_the_same_name_store_lock() {
        let case = archive_roundtrip_cases()
            .into_iter()
            .find(|case| case.coexisting_store)
            .unwrap();
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let (state, entry) = archive_fixture(&case);
            let mut lock = SkillLock::read().unwrap();
            lock.skills.insert(
                case.directory.clone(),
                test_lock_entry("independent/repo", "sha"),
            );
            lock.write().unwrap();
            let before = serde_json::to_value(&lock).unwrap();
            archive_one(&state, entry.id.clone()).unwrap();
            assert_eq!(
                serde_json::to_value(SkillLock::read().unwrap()).unwrap(),
                before
            );
            let manifest = ArchiveManifest::load().unwrap();
            let archived = manifest.skills.values().next().unwrap();
            assert!(archived.lock_key.is_none() && archived.lock_entry.is_none());
        });
    }

    #[test]
    fn external_imports_are_not_archiveable() {
        let skill = test_installed_skill("external:demo", "demo", "external");

        let err = ArchiveOwner::resolve(
            &skill.origin,
            skill.home_agent.as_deref(),
            &skill.name,
            skill.plugin_source.as_deref(),
        )
        .expect_err("external import should not archive");

        assert!(err.contains("External imports cannot be archived"));
    }

    #[test]
    fn archive_rejects_external_import_before_touching_files_or_stores() {
        let tmp = tempfile::tempdir().unwrap();
        config::with_test_home(tmp.path(), || {
            let source = tmp.path().join("private/demo");
            std::fs::create_dir_all(&source).unwrap();
            std::fs::write(source.join("SKILL.md"), "# Private skill").unwrap();
            let entry = test_cache_entry_with_home(
                "external:demo",
                "demo",
                "external",
                Some(source.to_string_lossy().into_owned()),
            );
            let state = AppState::new(
                SkillCache::from_entries(vec![entry]),
                crate::persistence::MetadataStore {
                    entries: Default::default(),
                },
                crate::persistence::Settings {
                    values: Default::default(),
                },
            );
            let result = archive_one(&state, "external:demo".into());
            assert!(result
                .unwrap_err()
                .contains("External imports cannot be archived"));
            assert_eq!(
                std::fs::read_to_string(source.join("SKILL.md")).unwrap(),
                "# Private skill"
            );
            assert!(!config::get_archive_manifest_file().exists());
            assert!(!config::get_app_config_dir().join("metadata.json").exists());
            assert!(state
                .skill_cache
                .read()
                .unwrap()
                .find_by_id("external:demo")
                .is_some());
        });
    }

    #[test]
    fn restore_maps_legacy_skill_id_to_canonical_metadata_key() {
        use crate::persistence::{MetadataStore, Settings};
        use std::collections::{BTreeMap, HashMap};

        let dir = tempfile::tempdir().expect("tempdir");
        let home = dir.path();
        crate::config::with_test_home(home, || {
            let archive_id = "demo-abc123";
            let archive_skill_dir = ArchiveManifest::archive_skill_dir(archive_id);
            std::fs::create_dir_all(&archive_skill_dir).expect("create archive dir");
            std::fs::write(archive_skill_dir.join("SKILL.md"), "# Demo").expect("write skill");

            let archived_skill = ArchivedSkill {
                extra: Default::default(),
                id: archive_id.to_string(),
                archive_id: archive_id.to_string(),
                original_skill_id: "repo:owner/repo:demo".to_string(),
                name: "demo".to_string(),
                yaml_name: None,
                description: None,
                directory: "demo".to_string(),
                repo_owner: Some("owner".to_string()),
                repo_name: Some("repo".to_string()),
                source_url: Some("https://github.com/owner/repo".to_string()),
                apps: HashMap::new(),
                origin: "ssot".to_string(),
                home_path: None,
                content_hash: None,
                home_agent: None,
                starred: true,
                is_mine: false,
                installed_at: 100,
                updated_at: 200,
                archived_at: 300,
                lock_key: Some("demo".to_string()),
                lock_entry: Some(test_lock_entry("owner/repo", "abc123")),
                archived_by_version: Some("test".to_string()),
                reason: None,
            };
            let manifest = ArchiveManifest {
                extra: Default::default(),
                version: SUPPORTED_ARCHIVE_VERSION,
                skills: BTreeMap::from([(archive_id.to_string(), archived_skill)]),
            };
            manifest.save().expect("save manifest");

            let state = AppState::new(
                SkillCache::empty(),
                MetadataStore {
                    entries: HashMap::new(),
                },
                Settings {
                    values: HashMap::new(),
                },
            );

            let restored =
                restore_one(&state, archive_id.to_string()).expect("restore archived skill");
            assert_eq!(restored, "ssot:demo");

            let metadata = state.metadata.read().expect("metadata lock");
            assert!(
                metadata.get("ssot:demo").starred,
                "restored star must be readable under the canonical key without a restart"
            );
            assert!(!metadata.entries.contains_key("repo:owner/repo:demo"));
        });
    }

    fn test_cache_entry_with_home(
        id: &str,
        directory: &str,
        origin: &str,
        home_path: Option<String>,
    ) -> crate::persistence::SkillCacheEntry {
        crate::persistence::SkillCacheEntry {
            id: id.to_string(),
            name: directory.to_string(),
            yaml_name: None,
            description: None,
            directory: directory.to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            source_url: Some("https://github.com/owner/repo".to_string()),
            origin: origin.to_string(),
            home_path,
            content_hash: None,
            hash_fingerprint: None,
            home_agent: None,
            plugin_source: None,
            apps: std::collections::HashMap::new(),
            installed_at: 0,
            updated_at: 0,
        }
    }

    fn test_installed_skill(id: &str, directory: &str, origin: &str) -> InstalledSkill {
        InstalledSkill {
            id: id.to_string(),
            name: directory.to_string(),
            yaml_name: None,
            description: None,
            directory: directory.to_string(),
            repo_owner: None,
            repo_name: None,
            source_url: None,
            apps: std::collections::HashMap::new(),
            origin: origin.to_string(),
            home_path: Some(directory.to_string()),
            content_hash: None,
            home_agent: None,
            plugin_source: None,
            starred: false,
            is_mine: false,
            installed_at: 0,
            updated_at: 0,
        }
    }

    fn test_lock_entry(source: &str, commit_sha: &str) -> SkillLockEntry {
        SkillLockEntry {
            extra: Default::default(),
            source: Some(source.to_string()),
            source_type: Some("github".to_string()),
            source_url: Some(format!("https://github.com/{source}")),
            branch: Some("main".to_string()),
            skill_path: Some("skills/demo".to_string()),
            skill_folder_hash: None,
            installed_at: None,
            updated_at: None,
            commit_sha: Some(commit_sha.to_string()),
            content_digest: None,
        }
    }
}
