use crate::persistence::{MetadataStore, Settings, SkillCache};
use std::sync::RwLock;
use std::sync::atomic::AtomicBool;

pub struct AppState {
    pub skill_cache: RwLock<SkillCache>,
    pub metadata: RwLock<MetadataStore>,
    pub settings: std::sync::Mutex<Settings>,
    pub sync_in_progress: AtomicBool,
}

impl AppState {
    pub fn new(skill_cache: SkillCache, metadata: MetadataStore, settings: Settings) -> Self {
        Self {
            skill_cache: RwLock::new(skill_cache),
            metadata: RwLock::new(metadata),
            settings: std::sync::Mutex::new(settings),
            sync_in_progress: AtomicBool::new(false),
        }
    }
}
