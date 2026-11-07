use crate::config;
use crate::error::AppError;
use crate::persistence::agent_transaction::AgentLease;
use crate::persistence::archive::SUPPORTED_ARCHIVE_VERSION;
use crate::persistence::external_imports::SUPPORTED_EXTERNAL_IMPORTS_VERSION;
use crate::persistence::{
    ArchiveManifest, ArchivedSkill, ExternalImports, MetadataStore, SkillCache,
};
use crate::services::lock::{SkillLock, SUPPORTED_LOCK_VERSION};
use crate::services::skill::{
    is_symlink_or_junction, plugin_read_only_error, same_directory, InstalledSkill, SkillService,
};
use crate::services::update_exit::UpdateGuard;
use crate::store::AppState;
use regex::Regex;
use serde::Serialize;
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

// The lease precedes the refresh lock, matching install/update lock order.
struct ArchiveWrite<'a> {
    state: &'a AppState,
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
            state,
            imports,
            _refresh: refresh,
            _lease: lease,
            _update: update,
        })
    }
    fn remove_cached_skill(&self, id: &str) -> Result<(), String> {
        let mut cache = self.state.skill_cache.write().map_err(|e| e.to_string())?;
        cache.remove(id);
        cache.save().map_err(|e| e.to_string())
    }

    fn edit_metadata(&self, edit: impl FnOnce(&mut MetadataStore)) -> Result<(), String> {
        let mut metadata = self.state.metadata.write().map_err(|e| e.to_string())?;
        edit(&mut metadata);
        metadata.save().map_err(|e| e.to_string())
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

// Only these owned sources may move. Wire/storage origins remain unchanged.
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
        SkillService::scan_skill_root(home, &self.root()?, agent).map_err(|e| e.to_string())
    }
}

struct ArchiveTarget {
    skill: InstalledSkill,
    home: PathBuf,
    owner: ArchiveOwner,
}

impl ArchiveTarget {
    fn resolve(write: &ArchiveWrite<'_>, skill_id: &str) -> Result<Self, String> {
        let skill = SkillService::read_all_skills(&write.state.skill_cache, &write.state.metadata)
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|s| s.id == skill_id)
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

    // External imports keep source files at their original location.
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

fn archive_skill_inner(write: &ArchiveWrite<'_>, skill_id: String) -> Result<(), String> {
    let state = write.state;
    let target = ArchiveTarget::resolve(write, &skill_id)?;
    let skill = target.skill;
    let home = target.home;
    let home_path = home.to_string_lossy().into_owned();

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

    let snapshot = ArchiveSnapshot::capture(state)?;
    let old_manifest = &snapshot.manifest;
    if old_manifest.skills.contains_key(&archive_id) {
        return Err(format!("Skill is already archived: {}", skill.name));
    }

    let old_lock = &snapshot.lock;
    let lock_key = if !matches!(target.owner, ArchiveOwner::Store) {
        None
    } else if old_lock.skills.contains_key(&skill.directory) {
        Some(skill.directory.clone())
    } else if old_lock.skills.contains_key(&skill.name) {
        Some(skill.name.clone())
    } else {
        None
    };
    let lock_entry = lock_key
        .as_ref()
        .and_then(|key| old_lock.skills.get(key).cloned());
    let archived_skill = ArchivedSkill::from_installed(
        skill.clone(),
        archive_id.clone(),
        lock_key.clone(),
        lock_entry,
    );

    let mut manifest = old_manifest.clone();
    manifest
        .skills
        .insert(archive_id.clone(), archived_skill.clone());
    manifest.save().map_err(|e| e.to_string())?;

    if let Some(parent) = archive_dir.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Err(recovery_error(
                format_archive_io_error("Create archive directory", parent, &e),
                snapshot.restore(state),
            ));
        }
    }

    let mut removed_agents: Vec<String> = Vec::new();
    let rollback = |message: String, removed_agents: &[String]| -> String {
        let mut errors = Vec::new();
        if archive_dir.exists() && !home.exists() {
            if let Some(parent) = home.parent() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    errors.push(format!("recreate skill parent: {e}"));
                }
            }
            if let Err(e) = std::fs::rename(&archive_dir, &home) {
                errors.push(format!("move archived skill back home: {e}"));
            }
        }
        for agent in removed_agents {
            if let Err(e) = SkillService::toggle_symlink(&skill.directory, &home_path, agent, true)
            {
                errors.push(format!("restore agent symlink: {e}"));
            }
        }
        errors.extend(snapshot.restore(state));
        recovery_error(message, errors)
    };

    for (agent, enabled) in &archived_skill.apps {
        if !enabled {
            continue;
        }
        // A native home is an entity, not an agent link. It is moved below;
        // nested native skills may also have no flat link at all.
        if archived_skill.home_agent.as_deref() == Some(agent.as_str()) {
            let flat_path = config::get_agent_skills_dir(agent)
                .map(|root| root.join(SkillService::agent_link_name(&skill.directory)));
            if flat_path.is_none_or(|path| !is_symlink_or_junction(&path)) {
                continue;
            }
        }
        match SkillService::toggle_symlink(&skill.directory, &home_path, agent, false) {
            Ok(()) => removed_agents.push(agent.clone()),
            Err(e) => {
                return Err(rollback(
                    format_archive_app_error("Remove agent link while archiving", e),
                    &removed_agents,
                ))
            }
        }
    }

    if let Err(e) = std::fs::rename(&home, &archive_dir) {
        return Err(rollback(
            format_archive_io_error("Move skill into archive", &archive_dir, &e),
            &removed_agents,
        ));
    }

    write
        .remove_cached_skill(&skill.id)
        .map_err(|e| rollback(e, &removed_agents))?;
    write
        .edit_metadata(|metadata| metadata.remove(&skill.id))
        .map_err(|e| rollback(e, &removed_agents))?;

    if let Some(key) = lock_key {
        if let Err(e) = SkillLock::update(|lock| {
            lock.skills.remove(&key);
            Ok::<(), AppError>(())
        }) {
            return Err(rollback(e.to_string(), &removed_agents));
        }
    }

    Ok(())
}

pub async fn archive_skills(
    state: &AppState,
    skill_ids: Vec<String>,
) -> Result<ArchiveSkillsResult, String> {
    let write = ArchiveWrite::begin(state).await?;
    let mut archived: Vec<String> = Vec::new();
    let mut failed: Vec<ArchiveSkillFailure> = Vec::new();

    for skill_id in skill_ids {
        match archive_skill_inner(&write, skill_id.clone()) {
            Ok(()) => archived.push(skill_id),
            Err(e) => failed.push(ArchiveSkillFailure { skill_id, error: e }),
        }
    }

    Ok(ArchiveSkillsResult { archived, failed })
}

pub async fn restore_archived_skills(
    state: &AppState,
    archive_ids: Vec<String>,
) -> Result<RestoreArchivedSkillsResult, String> {
    let write = ArchiveWrite::begin(state).await?;
    let mut restored: Vec<RestoredArchivedSkill> = Vec::new();
    let mut failed: Vec<RestoreArchivedSkillFailure> = Vec::new();

    let manifest = ArchiveManifest::load().map_err(|e| e.to_string())?;
    for archive_id in archive_ids {
        match restore_archived_skill_inner(&write, archive_id.clone()).and_then(|restored_id| {
            SkillService::read_all_skills(&state.skill_cache, &state.metadata)
                .map_err(|e| e.to_string())?
                .into_iter()
                .find(|skill| skill.id == restored_id)
                .ok_or_else(|| "Skill restored but not found in cache".to_string())
        }) {
            Ok(skill) => restored.push(RestoredArchivedSkill { archive_id, skill }),
            Err(e) => failed.push(RestoreArchivedSkillFailure {
                archive_id,
                error: e,
            }),
        }
    }

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
    Ok(RestoreArchivedSkillsResult {
        restored,
        failed,
        skipped_agents,
    })
}

fn restore_archived_skill_inner(
    write: &ArchiveWrite<'_>,
    archive_id: String,
) -> Result<String, String> {
    let state = write.state;
    validate_archive_id(&archive_id)?;
    let snapshot = ArchiveSnapshot::capture(state)?;
    let old_manifest = &snapshot.manifest;
    let archived_skill = old_manifest
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
        None if matches!(owner, ArchiveOwner::Store) => config::get_agents_skills_dir().join(&archived_skill.directory),
        None => return Err("Archive does not record the original agent home. The archive was preserved; restore its files manually rather than guessing a destination.".into()),
    };
    if restore_path.exists() {
        return Err(format!("Cannot restore: destination already exists at {}. Move, rename, archive, or remove the existing skill folder before restoring this archived skill.", restore_path.display()));
    }
    if let Some(parent) = restore_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format_archive_io_error("Create restore directory", parent, &e))?;
    }
    std::fs::rename(&archive_dir, &restore_path)
        .map_err(|e| format_archive_io_error("Move archived skill back", &restore_path, &e))?;

    let mut restored_agents: Vec<String> = Vec::new();
    let rollback = |message: String, restored_agents: &[String]| -> String {
        let mut errors = Vec::new();
        for agent in restored_agents {
            if let Err(e) = SkillService::toggle_symlink(
                &archived_skill.directory,
                &restore_path.to_string_lossy(),
                agent,
                false,
            ) {
                errors.push(format!("remove restored agent symlink: {e}"));
            }
        }
        if restore_path.exists() && !archive_dir.exists() {
            if let Some(parent) = archive_dir.parent() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    errors.push(format!("recreate archive parent: {e}"));
                }
            }
            if let Err(e) = std::fs::rename(&restore_path, &archive_dir) {
                errors.push(format!("move restored skill back to archive: {e}"));
            }
        }
        errors.extend(snapshot.restore(state));
        recovery_error(message, errors)
    };

    if matches!(owner, ArchiveOwner::Store) {
        if let Some(lock_entry) = archived_skill.lock_entry.clone() {
            let key = archived_skill
                .lock_key
                .clone()
                .unwrap_or_else(|| archived_skill.directory.clone());
            if let Err(e) = SkillLock::update(|lock| {
                lock.skills.insert(key, lock_entry);
                Ok::<(), AppError>(())
            }) {
                return Err(rollback(e.to_string(), &restored_agents));
            }
        }
    }

    write
        .edit_metadata(|metadata| {
            // Manifest IDs are historical records; map a legacy provenance-derived
            // ID to the canonical installation identity before touching metadata.
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
        })
        .map_err(|e| rollback(e, &restored_agents))?;

    for (agent, enabled) in &archived_skill.apps {
        if !enabled {
            continue;
        }
        let Some(agent_dir) = config::get_agent_skills_dir(agent) else {
            continue;
        };
        if !agent_dir.exists() {
            continue;
        }
        let agent_skill_path =
            agent_dir.join(SkillService::agent_link_name(&archived_skill.directory));
        if agent_skill_path.exists() && !is_symlink_or_junction(&agent_skill_path) {
            let is_native_home = agent_skill_path == restore_path
                || agent_skill_path
                    .canonicalize()
                    .ok()
                    .zip(restore_path.canonicalize().ok())
                    .is_some_and(|(agent_path, restore_path)| agent_path == restore_path);
            if is_native_home {
                continue;
            }
            return Err(rollback(
                format!(
                    "Restore agent link failed: destination already exists at {} and is a real directory, not a symlink.",
                    agent_skill_path.display()
                ),
                &restored_agents,
            ));
        }
        match SkillService::toggle_symlink(
            &archived_skill.directory,
            &restore_path.to_string_lossy(),
            agent,
            true,
        ) {
            Ok(()) => restored_agents.push(agent.clone()),
            Err(e) => {
                return Err(rollback(
                    format_archive_app_error("Restore agent link", e),
                    &restored_agents,
                ))
            }
        }
    }

    // Scan after symlinks are created so detect_agents finds the restored links.
    // External imports use the import registry to preserve origin = "external".
    let retained = write.imports.imports.get(&archived_skill.original_skill_id);
    let entry = if let Some(import) = retained {
        SkillService::scan_external_import(import)
            .map_err(|e| rollback(e.to_string(), &restored_agents))?
    } else {
        owner
            .scan(&restore_path)
            .map_err(|e| rollback(e, &restored_agents))?
    };
    let expected_id = if retained.is_some() {
        archived_skill.original_skill_id.clone()
    } else {
        crate::persistence::metadata::canonicalize_legacy_skill_id(
            &archived_skill.original_skill_id,
        )
        .unwrap_or_else(|| archived_skill.original_skill_id.clone())
    };
    if entry.id != expected_id {
        return Err(rollback(
            "Restored home does not match the recorded skill identity. The archive was preserved."
                .into(),
            &restored_agents,
        ));
    }
    let restored_id = entry.id.clone();
    if let Err(e) = SkillService::upsert_cache_entry(&state.skill_cache, entry) {
        return Err(rollback(e.to_string(), &restored_agents));
    }

    let mut manifest = old_manifest.clone();
    manifest.skills.remove(&archive_id);
    if let Err(e) = manifest.save() {
        return Err(rollback(e.to_string(), &restored_agents));
    }

    Ok(restored_id)
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
        let entry =
            SkillService::scan_skill_root(&home, root, (case.origin == "agent").then_some("codex"))
                .unwrap();
        let mut entries = vec![entry.clone()];
        if case.coexisting_store {
            let peer = store.join(&case.directory);
            std::fs::create_dir_all(&peer).unwrap();
            std::fs::write(peer.join("SKILL.md"), "# Independent store skill").unwrap();
            entries.push(SkillService::scan_skill_root(&peer, &store, None).unwrap());
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
            // Archived skill files under the archive skills dir.
            let archive_id = "demo-abc123";
            let archive_skill_dir = ArchiveManifest::archive_skill_dir(archive_id);
            std::fs::create_dir_all(&archive_skill_dir).expect("create archive dir");
            std::fs::write(archive_skill_dir.join("SKILL.md"), "# Demo").expect("write skill");

            // Manifest entry keeps the historical provenance-derived ID and
            // the user flags snapshotted at archive time.
            let archived_skill = ArchivedSkill {
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
            // The restored skill scans under the canonical identity.
            assert_eq!(restored, "ssot:demo");

            // The historical legacy ID must land on the canonical key.
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
        }
    }
}
