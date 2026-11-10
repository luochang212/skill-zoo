use crate::persistence::{MetadataStore, Settings, SkillCache};
use futures::future::{AbortHandle, AbortRegistration};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

#[derive(Default)]
pub struct RepoLoadCancels {
    tasks: Mutex<HashMap<String, Arc<AbortHandle>>>,
}

impl RepoLoadCancels {
    pub fn register(&self, key: &str) -> (AbortRegistration, Arc<AbortHandle>) {
        let (handle, registration) = AbortHandle::new_pair();
        let shared = Arc::new(handle);
        self.tasks
            .lock()
            .expect("repo load cancels lock")
            .insert(key.to_string(), Arc::clone(&shared));
        (registration, shared)
    }

    pub fn cancel(&self, key: &str) -> bool {
        let task = self
            .tasks
            .lock()
            .expect("repo load cancels lock")
            .remove(key);
        match task {
            Some(handle) => {
                handle.abort();
                true
            }
            None => false,
        }
    }

    pub fn finish(&self, key: &str, handle: &Arc<AbortHandle>) {
        self.tasks
            .lock()
            .expect("repo load cancels lock")
            .retain(|current_key, current| !(current_key == key && Arc::ptr_eq(current, handle)));
    }
}

pub struct AppState {
    pub update_exit: crate::services::update_exit::UpdateExitState,
    pub skill_cache: RwLock<SkillCache>,
    pub metadata: RwLock<MetadataStore>,
    pub settings: std::sync::Mutex<Settings>,
    pub cache_refresh_lock: tokio::sync::Mutex<()>,
    pub fs_watcher: std::sync::Mutex<Option<notify::RecommendedWatcher>>,
    pub watcher_task: std::sync::Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    pub repo_load_cancels: RepoLoadCancels,
}

impl AppState {
    pub fn acquire_local_lease(
        &self,
    ) -> Result<crate::persistence::agent_transaction::AgentLease, crate::error::AppError> {
        let lease = crate::persistence::agent_transaction::AgentLease::acquire(
            &crate::config::get_app_config_dir(),
        )?;
        let mut metadata = self
            .metadata
            .write()
            .map_err(|e| crate::error::AppError::Parse(format!("Metadata lock: {e}")))?;
        *metadata = MetadataStore::load()?;
        Ok(lease)
    }

    pub fn new(skill_cache: SkillCache, metadata: MetadataStore, settings: Settings) -> Self {
        Self {
            update_exit: Default::default(),
            skill_cache: RwLock::new(skill_cache),
            metadata: RwLock::new(metadata),
            settings: std::sync::Mutex::new(settings),
            cache_refresh_lock: tokio::sync::Mutex::new(()),
            fs_watcher: std::sync::Mutex::new(None),
            watcher_task: std::sync::Mutex::new(None),
            repo_load_cancels: RepoLoadCancels::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::future::Abortable;

    fn key() -> String {
        "owner/repo@HEAD".to_string()
    }

    #[tokio::test]
    async fn cancel_aborts_the_registered_load_future() {
        let cancels = RepoLoadCancels::default();
        let (registration, _handle) = cancels.register(&key());
        let load = Abortable::new(async { 42u8 }, registration);
        assert!(cancels.cancel(&key()));
        assert!(matches!(
            tokio::join!(load).0,
            Err(futures::future::Aborted)
        ));
    }

    #[tokio::test]
    async fn finish_freshens_only_its_own_handle_so_reload_stays_cancellable() {
        let cancels = RepoLoadCancels::default();
        let (_first_registration, first_handle) = cancels.register(&key());
        assert!(cancels.cancel(&key()));
        let (_second_registration, second_handle) = cancels.register(&key());

        cancels.finish(&key(), &first_handle);
        assert!(cancels.cancel(&key()));
        cancels.finish(&key(), &second_handle);
        assert!(!cancels.cancel(&key()));
    }

    #[test]
    fn cancel_without_a_live_task_is_a_noop() {
        let cancels = RepoLoadCancels::default();
        assert!(!cancels.cancel(&key()));
        let (_registration, handle) = cancels.register(&key());
        cancels.finish(&key(), &handle);
        assert!(!cancels.cancel(&key()));
    }

    #[test]
    fn finish_after_completion_makes_cancel_a_noop() {
        let cancels = RepoLoadCancels::default();
        let (_registration, handle) = cancels.register(&key());
        cancels.finish(&key(), &handle);
        assert!(!cancels.cancel(&key()));
    }
}
