use crate::persistence::{MetadataStore, Settings, SkillCache};
use std::sync::atomic::AtomicBool;
use std::sync::RwLock;

pub struct AppState {
    pub skill_cache: RwLock<SkillCache>,
    pub metadata: RwLock<MetadataStore>,
    pub settings: std::sync::Mutex<Settings>,
    pub sync_in_progress: AtomicBool,
    pub fs_watcher: std::sync::Mutex<Option<notify::RecommendedWatcher>>,
    pub watcher_task: std::sync::Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl AppState {
    pub fn new(skill_cache: SkillCache, metadata: MetadataStore, settings: Settings) -> Self {
        Self {
            skill_cache: RwLock::new(skill_cache),
            metadata: RwLock::new(metadata),
            settings: std::sync::Mutex::new(settings),
            sync_in_progress: AtomicBool::new(false),
            fs_watcher: std::sync::Mutex::new(None),
            watcher_task: std::sync::Mutex::new(None),
        }
    }
}
