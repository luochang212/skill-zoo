use super::*;
use crate::persistence::metadata::SkillMetadata;

impl SkillService {
    pub async fn merge_duplicates(
        state: &crate::store::AppState,
        skill_name: &str,
    ) -> Result<(), AppError> {
        let _update = state.update_exit.start_update();
        let _lease = state.acquire_local_lease()?;
        let _refresh = state.cache_refresh_lock.lock().await;
        Self::merge_duplicates_inner(skill_name, &state.skill_cache, &state.metadata)
    }

    #[cfg(any(test, feature = "test-helpers"))]
    pub fn merge_duplicates_to_ssot(
        skill_name: &str,
        cache: &RwLock<SkillCache>,
        metadata: &RwLock<MetadataStore>,
    ) -> Result<(), AppError> {
        Self::merge_duplicates_inner(skill_name, cache, metadata)
    }

    /// Merge all duplicates of a skill name into SSOT.
    /// Copies first skill's files to SSOT, creates symlinks only for agents
    /// that already had the skill, removes original non-SSOT directories,
    /// and migrates metadata from old IDs to the new merged ID.
    /// IMPORTANT: Caller must get user confirmation before calling this.
    /// Returns an error if the duplicates have different content (cannot auto-merge).
    fn merge_duplicates_inner(
        skill_name: &str,
        cache: &RwLock<SkillCache>,
        metadata: &RwLock<MetadataStore>,
    ) -> Result<(), AppError> {
        let name = Path::new(skill_name);
        if name.components().count() != 1
            || !matches!(
                name.components().next(),
                Some(std::path::Component::Normal(_))
            )
        {
            return Err(AppError::BadRequest("Invalid merge name".into()));
        }
        let imports = ExternalImports::load()?;
        if imports.version
            > crate::persistence::external_imports::SUPPORTED_EXTERNAL_IMPORTS_VERSION
        {
            return Err(AppError::BadRequest(
                "Unsupported external imports version".into(),
            ));
        }
        let entries: Vec<SkillCacheEntry> = {
            let c = cache
                .read()
                .map_err(|e| AppError::Parse(format!("Cache lock: {e}")))?;
            c.skills()
                .iter()
                .filter(|s| s.name == skill_name)
                .cloned()
                .collect()
        };

        if entries.is_empty() {
            return Err(AppError::NotFound(format!(
                "No skills found with name: {skill_name}"
            )));
        }

        // Filter out external imports and plugin skills. Their source files
        // are owned by the user or by the plugin, not by Skill Zoo.
        let entries: Vec<SkillCacheEntry> = entries
            .into_iter()
            .filter(|entry| entry.origin != "external" && entry.origin != "plugin")
            .collect();

        if entries.is_empty() {
            return Err(AppError::NotFound(format!(
                "No mergeable skills found with name: {skill_name}"
            )));
        }

        // Refuse to merge if content differs (safety check. The frontend should
        // already prevent this, but backend must enforce it too).
        if !Self::duplicates_have_verified_matching_content(&entries) {
            return Err(AppError::BadRequest(format!(
                "Cannot merge: skills named '{skill_name}' do not all have verified matching content. Please resolve manually."
            )));
        }

        let old_ids: HashSet<String> = entries.iter().map(|e| e.id.clone()).collect();
        let old_cache = cache
            .read()
            .map_err(|e| AppError::Parse(e.to_string()))?
            .clone();
        let old_metadata = metadata
            .read()
            .map_err(|e| AppError::Parse(e.to_string()))?
            .clone();

        // Use the first entry's home_path as source
        let source_path = entries[0]
            .home_path
            .as_ref()
            .ok_or_else(|| AppError::NotFound(format!("No home path for skill: {skill_name}")))?;

        let ssot_dir = config::get_agents_skills_dir();
        let dest_dir = ssot_dir.join(skill_name);

        // Verify live files before deleting any original; cache hashes may be stale.
        let expected_hash = Self::compute_content_hash(source_path)
            .ok_or_else(|| AppError::BadRequest("Cannot verify merge source".into()))?;
        for entry in &entries {
            let home = entry
                .home_path
                .as_deref()
                .ok_or_else(|| AppError::BadRequest("Cannot verify merge source".into()))?;
            let root = match entry.origin.as_str() {
                "ssot" => config::get_agents_skills_dir(),
                "agent" => entry
                    .home_agent
                    .as_deref()
                    .and_then(config::get_agent_skills_dir)
                    .ok_or_else(|| AppError::BadRequest("Unknown merge source owner".into()))?,
                _ => {
                    return Err(AppError::BadRequest(
                        "Unsupported merge source owner".into(),
                    ))
                }
            };
            let directory = Path::new(&entry.directory);
            if directory.as_os_str().is_empty()
                || directory
                    .components()
                    .any(|part| !matches!(part, std::path::Component::Normal(_)))
                || !same_directory(Path::new(home), &root.join(directory))
                || !Path::new(home)
                    .canonicalize()
                    .map_err(|e| error::io(Path::new(home), e))?
                    .ancestors()
                    .any(|parent| same_directory(parent, &root))
                || imports.imports.values().any(|import| {
                    import.id == entry.id
                        || same_directory(Path::new(&import.source_path), Path::new(home))
                })
            {
                return Err(AppError::BadRequest(
                    "Merge source no longer matches its recorded ownership".into(),
                ));
            }
            Self::ensure_merge_source_has_no_links(std::path::Path::new(home))?;
            if !std::path::Path::new(home).join("SKILL.md").is_file()
                || Self::compute_content_hash(home).as_ref() != Some(&expected_hash)
            {
                return Err(AppError::BadRequest(
                    "Merge sources changed; refresh and retry".into(),
                ));
            }
        }
        if std::fs::symlink_metadata(&dest_dir).is_ok()
            && (!entries.iter().any(|e| {
                e.origin == "ssot"
                    && e.home_path
                        .as_deref()
                        .is_some_and(|p| std::path::Path::new(p) == dest_dir)
            }) || dest_dir.is_symlink()
                || !dest_dir.join("SKILL.md").is_file())
        {
            return Err(AppError::BadRequest(
                "Merge destination is already occupied".into(),
            ));
        }
        let created_dest = !dest_dir.exists();
        if created_dest {
            std::fs::create_dir_all(&ssot_dir).map_err(|e| crate::error::io(&ssot_dir, e))?;
            if let Err(error) =
                Self::copy_dir_recursive(std::path::Path::new(source_path), &dest_dir)
            {
                let _ = std::fs::remove_dir_all(&dest_dir);
                return Err(error);
            }
        }
        if Self::compute_content_hash(&dest_dir.to_string_lossy()).as_ref() != Some(&expected_hash)
        {
            // A source may have changed after validation. Keep the originals
            // and remove only the destination this operation created.
            if created_dest {
                let _ = std::fs::remove_dir_all(&dest_dir);
            }
            return Err(AppError::BadRequest(
                "Cannot verify merge destination; originals were preserved".into(),
            ));
        }

        let mut files = MergeFiles::default();
        let result = (|| {
            let mut links = HashSet::new();
            // Save links before moving their targets, while physical matching is reliable.
            for entry in &entries {
                if entry.origin == "ssot" {
                    continue;
                }
                let home = Path::new(entry.home_path.as_deref().unwrap());
                for agent in config::agents().iter() {
                    let Some(root) = config::agent_skills_dir(agent) else {
                        continue;
                    };
                    let link = root.join(Self::agent_link_name(&entry.directory));
                    if is_symlink_or_junction(&link)
                        && symlink_target_state(&link, home) == LinkTargetState::Matches
                    {
                        files.stage(&link)?;
                        links.insert((agent.id.clone(), entry.directory.clone()));
                    }
                }
                if let Some(agent) = &entry.home_agent {
                    links.insert((agent.clone(), entry.directory.clone()));
                }
            }
            for entry in &entries {
                if entry.origin != "ssot" {
                    files.stage(Path::new(entry.home_path.as_deref().unwrap()))?;
                }
            }
            for (agent, directory) in links {
                // Never claim a pre-existing link in rollback ownership.
                let root = config::get_agent_skills_dir(&agent)
                    .ok_or_else(|| AppError::BadRequest(format!("Unknown agent: {agent}")))?;
                let link = root.join(Self::agent_link_name(&directory));
                let existed = std::fs::symlink_metadata(&link).is_ok();
                Self::toggle_symlink(&directory, &dest_dir.to_string_lossy(), &agent, true)?;
                if !existed {
                    files.created_links.push((directory, agent));
                }
            }
            let entry = Self::scan_skill_root(&dest_dir, &ssot_dir, None)?;
            let new_id = entry.id.clone();
            {
                let mut c = cache.write().map_err(|e| AppError::Parse(e.to_string()))?;
                c.remove_where(|entry| old_ids.contains(&entry.id));
                c.upsert(entry);
                c.save()?;
            }
            {
                let mut m = metadata
                    .write()
                    .map_err(|e| AppError::Parse(e.to_string()))?;
                let merged = SkillMetadata {
                    starred: old_ids.iter().any(|id| m.get(id).starred),
                    is_mine: old_ids.iter().any(|id| m.get(id).is_mine),
                };
                for id in &old_ids {
                    m.remove(id);
                }
                if merged.starred || merged.is_mine {
                    m.entries.insert(new_id, merged);
                }
                m.save()?;
            }
            Ok::<(), AppError>(())
        })();
        if let Err(error) = result {
            let mut errors = files.rollback(&dest_dir);
            if created_dest {
                if let Err(e) = std::fs::remove_dir_all(&dest_dir) {
                    errors.push(format!("remove new merge destination: {e}"));
                }
            }
            let restore_cache = cache
                .write()
                .map_err(|e| AppError::Parse(e.to_string()))
                .and_then(|mut c| {
                    *c = old_cache;
                    c.save()
                });
            if let Err(e) = restore_cache {
                errors.push(format!("restore cache: {e}"));
            }
            let restore_metadata = metadata
                .write()
                .map_err(|e| AppError::Parse(e.to_string()))
                .and_then(|mut m| {
                    *m = old_metadata;
                    m.save()
                });
            if let Err(e) = restore_metadata {
                errors.push(format!("restore metadata: {e}"));
            }
            return if errors.is_empty() {
                Err(error)
            } else {
                Err(AppError::Cli(format!(
                    "{error}. Recovery incomplete: {}",
                    errors.join("; ")
                )))
            };
        }
        files.commit();

        Ok(())
    }

    fn ensure_merge_source_has_no_links(path: &std::path::Path) -> Result<(), AppError> {
        if is_symlink_or_junction(path) {
            return Err(AppError::BadRequest(
                "Cannot merge skills containing symbolic links; originals were preserved".into(),
            ));
        }
        for entry in std::fs::read_dir(path).map_err(|e| crate::error::io(path, e))? {
            let entry = entry.map_err(|e| crate::error::io(path, e))?;
            let child = entry.path();
            if is_symlink_or_junction(&child) || child.is_dir() {
                Self::ensure_merge_source_has_no_links(&child)?;
            }
        }
        Ok(())
    }

    fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), AppError> {
        if !dst.exists() {
            std::fs::create_dir_all(dst).map_err(|e| crate::error::io(dst, e))?;
        }
        for entry in std::fs::read_dir(src).map_err(|e| crate::error::io(src, e))? {
            let entry = entry.map_err(|e| crate::error::io(src, e))?;
            let src_path = entry.path();
            let dst_path = dst.join(entry.file_name());
            if is_symlink_or_junction(&src_path) {
                return Err(AppError::BadRequest(
                    "Merge source changed to contain symbolic links; originals were preserved"
                        .into(),
                ));
            }
            if src_path.is_dir() {
                Self::copy_dir_recursive(&src_path, &dst_path)?;
            } else {
                std::fs::copy(&src_path, &dst_path).map_err(|e| crate::error::io(&src_path, e))?;
            }
        }
        Ok(())
    }
}

// Originals survive until both stores have committed. Failed recovery keeps backups.
#[derive(Default)]
struct MergeFiles {
    staged: Vec<(PathBuf, tempfile::TempDir)>,
    created_links: Vec<(String, String)>,
}

impl MergeFiles {
    fn stage(&mut self, original: &Path) -> Result<(), AppError> {
        let parent = original
            .parent()
            .ok_or_else(|| AppError::BadRequest("Missing merge source parent".into()))?;
        let name = original.file_name().unwrap().to_string_lossy();
        let backup = tempfile::Builder::new()
            .prefix(&format!(".{name}.backup."))
            .tempdir_in(parent)
            .map_err(|e| error::io(parent, e))?;
        std::fs::rename(original, backup.path().join("original"))
            .map_err(|e| error::io(original, e))?;
        self.staged.push((original.to_path_buf(), backup));
        Ok(())
    }

    fn rollback(self, destination: &Path) -> Vec<String> {
        let mut errors = Vec::new();
        for (directory, agent) in self.created_links.iter().rev() {
            if let Err(e) = SkillService::toggle_symlink(
                directory,
                &destination.to_string_lossy(),
                agent,
                false,
            ) {
                errors.push(format!("remove merged link: {e}"));
            }
        }
        for (original, backup) in self.staged.into_iter().rev() {
            if std::fs::symlink_metadata(&original).is_ok() {
                errors.push(format!(
                    "restore {}: destination exists; backup retained at {}",
                    original.display(),
                    backup.keep().display()
                ));
            } else if let Err(e) = std::fs::rename(backup.path().join("original"), &original) {
                errors.push(format!(
                    "restore {}: {e}; backup retained at {}",
                    original.display(),
                    backup.keep().display()
                ));
            }
        }
        errors
    }

    fn commit(self) {
        for (_, backup) in self.staged {
            let path = backup.path().to_path_buf();
            if let Err(e) = backup.close() {
                eprintln!(
                    "Merge committed; failed to remove backup {}: {e}",
                    path.display()
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_recovery_keeps_original_backup_when_an_external_writer_recreates_home() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("demo");
        std::fs::create_dir(&home).unwrap();
        std::fs::write(home.join("SKILL.md"), "original").unwrap();
        let mut files = MergeFiles::default();
        files.stage(&home).unwrap();
        let backup = files.staged[0].1.path().to_path_buf();
        std::fs::create_dir(&home).unwrap();
        std::fs::write(home.join("foreign.txt"), "keep").unwrap();
        let errors = files.rollback(&tmp.path().join("ssot"));
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains(&backup.display().to_string()));
        assert_eq!(
            std::fs::read_to_string(backup.join("original/SKILL.md")).unwrap(),
            "original"
        );
        assert_eq!(
            std::fs::read_to_string(home.join("foreign.txt")).unwrap(),
            "keep"
        );
    }
}
