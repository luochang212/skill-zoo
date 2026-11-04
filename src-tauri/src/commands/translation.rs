use crate::persistence::llm_providers::{
    self as config, ProviderSummary, ProviderUpdate, TranslationPreferences,
};
use crate::services::{
    llm,
    translation::{self, ProtectedMarkdown},
};
use crate::store::AppState;
use futures::future::{AbortHandle, AbortRegistration, Abortable};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{ipc::Channel, State};

struct Task {
    handle: AbortHandle,
    registration: Option<AbortRegistration>,
    cancelled: bool,
}
#[derive(Default)]
struct Runtime {
    tasks: HashMap<String, Task>,
    cache_epoch: u64,
}
#[derive(Default)]
pub struct TranslationState {
    config_lock: Mutex<()>,
    runtime: Mutex<Runtime>,
}

fn provider_path() -> PathBuf {
    crate::config::get_app_config_dir().join("llm_providers.json")
}
fn preferences_path() -> PathBuf {
    crate::config::get_app_config_dir().join("translation_preferences.json")
}
fn cache_dir() -> PathBuf {
    crate::config::get_app_config_dir().join("translations")
}

#[tauri::command]
pub async fn resolve_model_configuration(
    base_url: String,
    model_id: String,
) -> Result<Option<crate::services::model_catalog::ModelRecommendation>, String> {
    crate::services::model_catalog::resolve(&base_url, &model_id).await
}

#[tauri::command]
pub fn get_llm_provider_api_key(
    state: State<'_, TranslationState>,
    id: String,
) -> Result<String, String> {
    let _lock = state.config_lock.lock().map_err(|_| "configRead")?;
    config::load(&provider_path())?
        .providers
        .into_iter()
        .find(|provider| provider.id == id)
        .map(|provider| provider.api_key)
        .ok_or_else(|| "providerMissing".into())
}

#[tauri::command]
pub fn list_llm_providers(
    state: State<'_, TranslationState>,
) -> Result<Vec<ProviderSummary>, String> {
    let _lock = state.config_lock.lock().map_err(|_| "configRead")?;
    Ok(config::load(&provider_path())?
        .providers
        .iter()
        .map(ProviderSummary::from)
        .collect())
}
#[tauri::command]
pub fn upsert_llm_provider(
    state: State<'_, TranslationState>,
    provider: ProviderUpdate,
) -> Result<Vec<ProviderSummary>, String> {
    let _lock = state.config_lock.lock().map_err(|_| "configWrite")?;
    config::upsert(&provider_path(), provider)
}

fn connection_draft(path: &Path, update: ProviderUpdate) -> Result<config::Provider, String> {
    let previous = if let Some(id) = &update.id {
        Some(
            config::load(path)?
                .providers
                .into_iter()
                .find(|p| &p.id == id)
                .ok_or("providerMissing")?,
        )
    } else {
        None
    };
    let mut provider = config::Provider {
        id: update.id.unwrap_or_default(),
        name: update.name,
        enabled: update.enabled,
        protocol: update.protocol,
        base_url: update.base_url,
        api_key: update
            .api_key
            .unwrap_or_else(|| previous.map(|p| p.api_key).unwrap_or_default()),
        models: update.models,
    };
    config::validate(&mut provider)?;
    Ok(provider)
}

#[tauri::command]
pub async fn test_llm_connection(
    state: State<'_, TranslationState>,
    provider: ProviderUpdate,
    model_id: String,
) -> Result<u64, String> {
    let provider = {
        let _lock = state.config_lock.lock().map_err(|_| "configRead")?;
        connection_draft(&provider_path(), provider)?
    };
    if !provider.models.iter().any(|m| m.id == model_id) {
        return Err("modelMissing".into());
    }
    llm::test_connection(&provider, &model_id).await
}
#[tauri::command]
pub fn delete_llm_provider(state: State<'_, TranslationState>, id: String) -> Result<(), String> {
    let _lock = state.config_lock.lock().map_err(|_| "configWrite")?;
    let path = provider_path();
    let mut file = config::load(&path)?;
    file.providers.retain(|p| p.id != id);
    config::save(&path, &file)
}
#[tauri::command]
pub fn recover_llm_providers(state: State<'_, TranslationState>) -> Result<(), String> {
    let _lock = state.config_lock.lock().map_err(|_| "configWrite")?;
    config::recover(&provider_path())
}

#[tauri::command]
pub fn get_translation_preferences(
    state: State<'_, TranslationState>,
) -> Result<TranslationPreferences, String> {
    let _lock = state.config_lock.lock().map_err(|_| "configRead")?;
    match std::fs::read(preferences_path()) {
        Ok(bytes) => {
            let p: TranslationPreferences =
                serde_json::from_slice(&bytes).map_err(|_| "configCorrupt")?;
            p.validate()?;
            Ok(p)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(TranslationPreferences::default()),
        Err(_) => Err("configRead".into()),
    }
}
#[tauri::command]
pub fn save_translation_preferences(
    state: State<'_, TranslationState>,
    preferences: TranslationPreferences,
) -> Result<(), String> {
    preferences.validate()?;
    let _lock = state.config_lock.lock().map_err(|_| "configWrite")?;
    let path = preferences_path();
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|_| "configWrite")?;
    crate::persistence::atomic_write_private(
        &path,
        serde_json::to_vec(&preferences).map_err(|_| "configWrite")?,
    )
    .map_err(|_| "configWrite".into())
}

impl TranslationState {
    fn start(&self, id: String) -> Result<(), String> {
        if id.is_empty() || id.len() > 128 {
            return Err("taskId".into());
        }
        let mut runtime = self.runtime.lock().map_err(|_| "taskId")?;
        if runtime.tasks.contains_key(&id) || runtime.tasks.len() >= 32 {
            return Err("taskId".into());
        }
        let (handle, registration) = AbortHandle::new_pair();
        runtime.tasks.insert(
            id,
            Task {
                handle,
                registration: Some(registration),
                cancelled: false,
            },
        );
        Ok(())
    }
    fn cancel(&self, id: &str) -> Result<(), String> {
        let mut runtime = self.runtime.lock().map_err(|_| "taskId")?;
        if let Some(task) = runtime.tasks.get_mut(id) {
            task.cancelled = true;
            task.handle.abort();
            // Before translate starts, removing the registration also prevents any later request.
            if task.registration.is_some() {
                runtime.tasks.remove(id);
            }
        }
        Ok(())
    }
    fn take(&self, id: &str) -> Result<(AbortRegistration, u64), String> {
        let mut runtime = self.runtime.lock().map_err(|_| "taskId")?;
        let epoch = runtime.cache_epoch;
        let task = runtime.tasks.get_mut(id).ok_or("cancelled")?;
        Ok((task.registration.take().ok_or("taskId")?, epoch))
    }
    fn clear(&self, dir: &Path) -> Result<(), String> {
        let mut runtime = self.runtime.lock().map_err(|_| "cacheWrite")?;
        runtime.cache_epoch += 1;
        if dir.exists() {
            std::fs::remove_dir_all(dir).map_err(|_| "cacheWrite")?;
        }
        Ok(())
    }
    fn commit(
        &self,
        id: &str,
        epoch: u64,
        path: &Path,
        text: &str,
        write: bool,
    ) -> Result<(), String> {
        let mut runtime = self.runtime.lock().map_err(|_| "cacheWrite")?;
        let task = runtime.tasks.remove(id).ok_or("cancelled")?;
        if task.cancelled {
            return Err("cancelled".into());
        }
        // This lock is the linearization point for cancellation and cache clearing.
        if write && epoch == runtime.cache_epoch {
            std::fs::create_dir_all(path.parent().unwrap()).map_err(|_| "cacheWrite")?;
            crate::persistence::atomic_write_private(path, text).map_err(|_| "cacheWrite")?;
        }
        Ok(())
    }
}

#[tauri::command]
pub fn start_translation_task(
    state: State<'_, TranslationState>,
    task_id: String,
) -> Result<(), String> {
    state.start(task_id)
}
#[tauri::command]
pub fn cancel_translation(
    state: State<'_, TranslationState>,
    task_id: String,
) -> Result<(), String> {
    state.cancel(&task_id)
}
#[tauri::command]
pub fn clear_translation_cache(state: State<'_, TranslationState>) -> Result<(), String> {
    state.clear(&cache_dir())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationRequest {
    pub task_id: String,
    pub skill_id: String,
    pub path: String,
    pub source: String,
    pub provider_id: String,
    pub model_id: String,
    pub target_language: String,
    pub force: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TranslationEvent {
    Preview {
        #[serde(rename = "taskId")]
        task_id: String,
        text: String,
    },
    Completed {
        #[serde(rename = "taskId")]
        task_id: String,
        text: String,
    },
    Failed {
        #[serde(rename = "taskId")]
        task_id: String,
        code: String,
    },
    Repairing {
        #[serde(rename = "taskId")]
        task_id: String,
    },
}

fn read_source(state: &AppState, skill_id: &str, path: &str, source: &str) -> Result<(), String> {
    use crate::services::skill::ManagedSkill;
    if !path.to_ascii_lowercase().ends_with(".md") {
        return Err("markdownOnly".into());
    }
    let cache = state.skill_cache.read().map_err(|_| "sourceRead")?;
    let skill = match ManagedSkill::resolve(&cache, skill_id, false) {
        Ok(skill) => skill,
        Err(_) => {
            let manifest = crate::persistence::ArchiveManifest::load().map_err(|_| "sourceRead")?;
            let archived = manifest.skills.get(skill_id).ok_or("sourceRead")?;
            let root = if archived.origin == "external" {
                PathBuf::from(archived.home_path.as_ref().ok_or("sourceRead")?)
            } else {
                crate::persistence::ArchiveManifest::archive_skill_dir(&archived.archive_id)
            };
            // Use the same path containment validation for archive files.
            let entry = crate::persistence::SkillCacheEntry {
                id: archived.id.clone(),
                name: archived.name.clone(),
                yaml_name: None,
                description: None,
                directory: String::new(),
                repo_owner: None,
                repo_name: None,
                source_url: None,
                origin: archived.origin.clone(),
                home_path: Some(root.to_string_lossy().into_owned()),
                content_hash: None,
                home_agent: None,
                apps: Default::default(),
                plugin_source: None,
                installed_at: 0,
                updated_at: 0,
            };
            ManagedSkill::resolve(
                &crate::persistence::SkillCache::from_entries(vec![entry]),
                skill_id,
                false,
            )
            .map_err(|_| "sourceRead")?
        }
    };
    let path = skill.existing_path(path).map_err(|_| "sourceRead")?;
    let mut file = std::fs::File::open(path).map_err(|_| "sourceRead")?;
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(
        &mut std::io::Read::take(&mut file, translation::MAX_SOURCE_BYTES as u64 + 1),
        &mut bytes,
    )
    .map_err(|_| "sourceRead")?;
    if bytes.len() > translation::MAX_SOURCE_BYTES {
        return Err("sourceLimit".into());
    }
    if bytes != source.as_bytes() {
        return Err("sourceChanged".into());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationCacheRequest {
    pub skill_id: String,
    pub path: String,
    pub source: String,
    pub provider_id: String,
    pub model_id: String,
    pub target_language: String,
}

fn cached_translation(
    app: &AppState,
    state: &TranslationState,
    request: &TranslationCacheRequest,
    root: &Path,
) -> Result<Option<String>, String> {
    if request.source.len() > translation::MAX_SOURCE_BYTES {
        return Err("sourceLimit".into());
    }
    if !config::LANGUAGES.contains(&request.target_language.as_str()) {
        return Err("targetLanguage".into());
    }
    read_source(app, &request.skill_id, &request.path, &request.source)?;
    let provider = {
        let _lock = state.config_lock.lock().map_err(|_| "configRead")?;
        config::load(&root.join("llm_providers.json"))?
            .providers
            .into_iter()
            .find(|p| p.id == request.provider_id && p.enabled)
            .ok_or("providerMissing")?
    };
    let model = provider
        .models
        .iter()
        .find(|m| m.id == request.model_id && m.enabled)
        .ok_or("modelMissing")?;
    let path = root.join("translations").join(format!(
        "{}.md",
        translation::cache_key(&provider, model, &request.target_language, &request.source)
    ));
    // This entry point only reads disk. A miss or error must never fall through to inference.
    match std::fs::read_to_string(path) {
        Ok(text) if !text.trim().is_empty() => Ok(Some(text)),
        Ok(_) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("cacheRead".into()),
    }
}

#[tauri::command]
pub fn read_cached_translation(
    app: State<'_, AppState>,
    state: State<'_, TranslationState>,
    request: TranslationCacheRequest,
) -> Result<Option<String>, String> {
    cached_translation(&app, &state, &request, &crate::config::get_app_config_dir())
}

#[tauri::command]
pub async fn translate_skill(
    app: State<'_, AppState>,
    state: State<'_, TranslationState>,
    request: TranslationRequest,
    channel: Channel<TranslationEvent>,
) -> Result<(), String> {
    run_translation(
        &app,
        &state,
        request,
        &crate::config::get_app_config_dir(),
        |event| channel.send(event).map_err(|_| "cancelled".into()),
    )
    .await
}

async fn run_translation(
    app: &AppState,
    state: &TranslationState,
    request: TranslationRequest,
    root: &Path,
    emit: impl Fn(TranslationEvent) -> Result<(), String> + Send + Sync,
) -> Result<(), String> {
    let (registration, epoch) = state.take(&request.task_id)?;
    let result = Abortable::new(
        async {
            if request.source.len() > translation::MAX_SOURCE_BYTES {
                return Err("sourceLimit".into());
            }
            if !config::LANGUAGES.contains(&request.target_language.as_str()) {
                return Err("targetLanguage".into());
            }
            read_source(app, &request.skill_id, &request.path, &request.source)?;
            let provider = {
                let _lock = state.config_lock.lock().map_err(|_| "configRead")?;
                config::load(&root.join("llm_providers.json"))?
                    .providers
                    .into_iter()
                    .find(|p| p.id == request.provider_id && p.enabled)
                    .ok_or("providerMissing")?
            };
            let model = provider
                .models
                .iter()
                .find(|m| m.id == request.model_id && m.enabled)
                .ok_or("modelMissing")?;
            let path = root.join("translations").join(format!(
                "{}.md",
                translation::cache_key(&provider, model, &request.target_language, &request.source)
            ));
            if !request.force {
                match std::fs::read_to_string(&path) {
                    Ok(text) if !text.is_empty() => return Ok((path, text, false)),
                    Ok(_) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(_) => return Err("cacheRead".into()),
                }
            }
            let protected = ProtectedMarkdown::new(&request.source);
            let raw = tokio::time::timeout(
                std::time::Duration::from_secs(180),
                llm::stream(
                    &provider,
                    model,
                    &translation::system_prompt(&request.target_language),
                    &protected.input,
                    |raw| {
                        emit(TranslationEvent::Preview {
                            task_id: request.task_id.clone(),
                            text: protected.preview(raw),
                        })
                        .map_err(|_| "cancelled".into())
                    },
                ),
            )
            .await
            .map_err(|_| "timeout")??;
            let text = match protected.restore(&raw) {
                Ok(text) => text,
                Err(code) if code == "fidelity" => {
                    // One diagnostic-guided repair: re-translate only the
                    // fragments that lost markers, splice between the intact
                    // markers, and re-validate the whole document.
                    let _ = emit(TranslationEvent::Repairing {
                        task_id: request.task_id.clone(),
                    });
                    let plan = protected.repair_plan(&raw);
                    if plan.is_empty() {
                        return Err("fidelity".into());
                    }
                    let repaired = tokio::time::timeout(
                        std::time::Duration::from_secs(180),
                        llm::stream(
                            &provider,
                            model,
                            &translation::repair_system_prompt(&request.target_language),
                            &translation::repair_input(&plan),
                            |_raw| Ok(()),
                        ),
                    )
                    .await
                    .map_err(|_| "timeout")??;
                    let pieces =
                        translation::parse_translations(&repaired, plan.len()).ok_or("fidelity")?;
                    let spliced = protected.splice(&raw, &pieces)?;
                    protected.restore(&spliced)?
                }
                Err(code) => return Err(code),
            };
            Ok::<_, String>((path, text, true))
        },
        registration,
    )
    .await;
    let result = match result {
        Ok(Ok((path, text, write))) => state
            .commit(&request.task_id, epoch, &path, &text, write)
            .map(|_| text),
        Ok(Err(code)) => {
            let _ = state.cancel(&request.task_id);
            Err(code)
        }
        Err(_) => Err("cancelled".into()),
    };
    if let Ok(mut runtime) = state.runtime.lock() {
        runtime.tasks.remove(&request.task_id);
    }
    match result {
        Ok(text) => {
            let _ = emit(TranslationEvent::Completed {
                task_id: request.task_id,
                text,
            });
        }
        Err(code) if code == "cancelled" => {}
        Err(code) => {
            let _ = emit(TranslationEvent::Failed {
                task_id: request.task_id,
                code,
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn repair_round_repairs_damaged_markers_and_reports_the_repair_event() {
        let mut server = mockito::Server::new_async().await;
        let dir = tempfile::tempdir().unwrap();
        let skill = dir.path().join("skill");
        std::fs::create_dir_all(&skill).unwrap();
        let source = "# Hello\n\n```sh\nrm file\n```\n";
        std::fs::write(skill.join("guide.md"), source).unwrap();
        let app = app_for(&skill);
        let state = TranslationState::default();
        let root = dir.path().join("app");
        let config_path = root.join("llm_providers.json");
        use crate::persistence::llm_providers::{Model, Protocol, ProviderUpdate};
        let summaries = config::upsert(
            &config_path,
            ProviderUpdate {
                id: None,
                name: "Test".into(),
                enabled: true,
                protocol: Protocol::OpenaiChatCompletions,
                base_url: format!("{}/v1/", server.url()),
                api_key: None,
                models: vec![Model {
                    id: "test".into(),
                    enabled: true,
                    max_output_tokens: None,
                    context_window: None,
                }],
            },
        )
        .unwrap();
        let protected = translation::ProtectedMarkdown::new(source);
        let token = protected.parts[0].0.clone();
        let flawed = "# 你好\n\n";
        let fixed = format!("=== TRANSLATION 1 ===\n# 你好\n\n{token}");
        let sse = |content: &str| {
            format!(
                "data: {}\n\ndata: [DONE]\n\n",
                serde_json::json!({"choices":[{"delta":{"content":content},"finish_reason":"stop"}]})
            )
        };
        // mockito matches creation-first: the specific repair mock must come
        // before the catch-all translate mock.
        let repair_mock = server
            .mock("POST", "/v1/chat/completions")
            .match_body(mockito::Matcher::Regex("=== FRAGMENT 1 ===".to_string()))
            .with_status(200)
            .with_header("content-type", "text/event-stream")
            .with_body(sse(&fixed))
            .expect(1)
            .create_async()
            .await;
        let translate_mock = server
            .mock("POST", "/v1/chat/completions")
            .with_status(200)
            .with_header("content-type", "text/event-stream")
            .with_body(sse(flawed))
            .expect(1)
            .create_async()
            .await;
        let request = TranslationRequest {
            task_id: "repair-e2e".into(),
            skill_id: "plugin:test".into(),
            path: "guide.md".into(),
            source: source.into(),
            provider_id: summaries[0].id.clone(),
            model_id: "test".into(),
            target_language: "zh-CN".into(),
            force: false,
        };
        state.start(request.task_id.clone()).unwrap();
        let events = std::sync::Mutex::new(Vec::new());
        run_translation(&app, &state, request, &root, |event| {
            events.lock().unwrap().push(event);
            Ok(())
        })
        .await
        .unwrap();
        let events = events.into_inner().unwrap();
        assert!(
            events
                .iter()
                .any(|e| matches!(e, TranslationEvent::Repairing { .. })),
            "expected a Repairing event, got {events:?}"
        );
        let completed = events
            .iter()
            .find_map(|e| match e {
                TranslationEvent::Completed { text, .. } => Some(text.clone()),
                _ => None,
            })
            .expect("completed event");
        assert_eq!(completed, "# 你好\n\n```sh\nrm file\n```\n");
        translate_mock.assert_async().await;
        repair_mock.assert_async().await;
        let provider = config::load(&config_path).unwrap().providers.remove(0);
        let key = translation::cache_key(&provider, &provider.models[0], "zh-CN", source);
        assert_eq!(
            std::fs::read_to_string(root.join("translations").join(format!("{key}.md"))).unwrap(),
            completed
        );
    }
    #[test]
    fn connection_draft_preserves_write_only_key_semantics_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("llm_providers.json");
        let update = || ProviderUpdate {
            id: None,
            name: "Test".into(),
            enabled: true,
            protocol: config::Protocol::OpenaiChatCompletions,
            base_url: "http://localhost/v1".into(),
            api_key: Some("stored-key".into()),
            models: vec![],
        };
        let summaries = config::upsert(&path, update()).unwrap();
        let before = std::fs::read(&path).unwrap();
        for (key, expected) in [
            (None, "stored-key"),
            (Some("replacement".to_owned()), "replacement"),
            (Some(String::new()), ""),
        ] {
            let mut draft = update();
            draft.id = Some(summaries[0].id.clone());
            draft.api_key = key;
            draft.base_url = "http://localhost:1234/v1".into();
            let provider = connection_draft(&path, draft).unwrap();
            assert_eq!(provider.api_key, expected);
            assert_eq!(provider.base_url, "http://localhost:1234/v1/");
            assert_eq!(std::fs::read(&path).unwrap(), before);
        }
        let missing = dir.path().join("new.json");
        assert!(connection_draft(&missing, update()).is_ok());
        assert!(!missing.exists());
        let mut invalid = update();
        invalid.base_url = "https://user:secret@example.com/v1".into();
        assert!(matches!(connection_draft(&path, invalid), Err(code) if code == "baseUrl"));
    }
    #[tokio::test]
    async fn cancellation_before_and_after_take_prevents_commit() {
        let state = TranslationState::default();
        state.start("early".into()).unwrap();
        state.cancel("early").unwrap();
        assert!(state.take("early").is_err());
        state.start("running".into()).unwrap();
        let (reg, epoch) = state.take("running").unwrap();
        state.cancel("running").unwrap();
        assert!(Abortable::new(async { 42 }, reg).await.is_err());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.md");
        assert!(state
            .commit("running", epoch, &path, "partial", true)
            .is_err());
        assert!(!path.exists());
    }
    #[test]
    fn clear_epoch_prevents_inflight_repopulation_and_success_is_atomic() {
        let state = TranslationState::default();
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("translations");
        let path = cache.join("test.md");
        state.start("a".into()).unwrap();
        let (_, epoch) = state.take("a").unwrap();
        state.clear(&cache).unwrap();
        state.commit("a", epoch, &path, "old", true).unwrap();
        assert!(!path.exists());
        state.start("b".into()).unwrap();
        let (_, epoch) = state.take("b").unwrap();
        state.commit("b", epoch, &path, "complete", true).unwrap();
        state.cancel("b").unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "complete");
    }
    fn app_for(root: &Path) -> AppState {
        let entry: crate::persistence::SkillCacheEntry = serde_json::from_value(serde_json::json!({
            "id":"plugin:test", "name":"demo", "yamlName":null,"description":null,"directory":"demo",
            "repoOwner":null,"repoName":null,"sourceUrl":null,"origin":"plugin","homePath":root,
            "contentHash":null,"homeAgent":null,"apps":{},"installedAt":0,"updatedAt":0
        })).unwrap();
        AppState::new(
            crate::persistence::SkillCache::from_entries(vec![entry]),
            crate::persistence::MetadataStore {
                entries: Default::default(),
            },
            crate::persistence::Settings {
                values: Default::default(),
            },
        )
    }
    #[test]
    fn cache_only_read_checks_source_language_and_effective_config_without_writing() {
        use crate::persistence::llm_providers::{Model, Protocol, ProviderUpdate};
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("skill");
        std::fs::create_dir_all(source.join("references")).unwrap();
        std::fs::write(source.join("references/guide.md"), "# Hello").unwrap();
        let app = app_for(&source);
        let state = TranslationState::default();
        let root = dir.path().join("app");
        let path = root.join("llm_providers.json");
        let summaries = config::upsert(
            &path,
            ProviderUpdate {
                id: None,
                name: "Test".into(),
                enabled: true,
                protocol: Protocol::OpenaiChatCompletions,
                base_url: "http://127.0.0.1:1/v1/".into(),
                api_key: None,
                models: vec![Model {
                    id: "test".into(),
                    enabled: true,
                    max_output_tokens: None,
                    context_window: None,
                }],
            },
        )
        .unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let mut request = TranslationCacheRequest {
            skill_id: "plugin:test".into(),
            path: "references/guide.md".into(),
            source: "# Hello".into(),
            provider_id: summaries[0].id.clone(),
            model_id: "test".into(),
            target_language: "zh-CN".into(),
        };
        assert_eq!(
            cached_translation(&app, &state, &request, &root).unwrap(),
            None
        );
        assert!(!root.join("translations").exists());
        let provider = config::load(&path).unwrap().providers.remove(0);
        let key = translation::cache_key(&provider, &provider.models[0], "zh-CN", "# Hello");
        std::fs::create_dir_all(root.join("translations")).unwrap();
        std::fs::write(
            root.join("translations").join(format!("{key}.md")),
            "# 你好",
        )
        .unwrap();
        assert_eq!(
            cached_translation(&app, &state, &request, &root).unwrap(),
            Some("# 你好".into())
        );
        request.target_language = "en".into();
        assert_eq!(
            cached_translation(&app, &state, &request, &root).unwrap(),
            None
        );
        request.source = "unsaved draft".into();
        assert_eq!(
            cached_translation(&app, &state, &request, &root),
            Err("sourceChanged".into())
        );
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        request.source = "# Hello".into();
        request.target_language = "zh-CN".into();
        let mut changed = config::load(&path).unwrap();
        changed.providers[0].base_url = "http://127.0.0.1:2/v1/".into();
        config::save(&path, &changed).unwrap();
        let changed_bytes = std::fs::read(&path).unwrap();
        assert_eq!(
            cached_translation(&app, &state, &request, &root).unwrap(),
            None
        );
        assert_eq!(std::fs::read(&path).unwrap(), changed_bytes);
        assert!(state.runtime.lock().unwrap().tasks.is_empty());
    }
    fn request(id: &str, provider: &str) -> TranslationRequest {
        TranslationRequest {
            task_id: id.into(),
            skill_id: "plugin:test".into(),
            path: "references/guide.md".into(),
            source: "# Hello".into(),
            provider_id: provider.into(),
            model_id: "test".into(),
            target_language: "zh-CN".into(),
            force: false,
        }
    }
    #[tokio::test]
    async fn production_pipeline_caches_only_success_and_keeps_original_files() {
        use crate::persistence::llm_providers::{Model, Protocol, ProviderUpdate};
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("skill");
        std::fs::create_dir_all(source.join("references")).unwrap();
        std::fs::write(source.join("references/guide.md"), "# Hello").unwrap();
        let app = app_for(&source);
        let state = TranslationState::default();
        let mut server = mockito::Server::new_async().await;
        let root = dir.path().join("app");
        let providers = config::upsert(
            &root.join("llm_providers.json"),
            ProviderUpdate {
                id: None,
                name: "Test".into(),
                enabled: true,
                protocol: Protocol::OpenaiChatCompletions,
                base_url: format!("{}/v1/", server.url()),
                api_key: None,
                models: vec![Model {
                    id: "test".into(),
                    enabled: true,
                    max_output_tokens: None,
                    context_window: None,
                }],
            },
        )
        .unwrap();
        let provider = &providers[0].id;
        let events = Mutex::new(Vec::new());
        let mock = server.mock("POST", "/v1/chat/completions").with_status(200)
            .with_header("content-type","text/event-stream")
            .with_body("data: {\"choices\":[{\"delta\":{\"content\":\"# 你好\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n").expect(1).create_async().await;
        state.start("first".into()).unwrap();
        run_translation(&app, &state, request("first", provider), &root, |e| {
            events.lock().unwrap().push(e);
            Ok(())
        })
        .await
        .unwrap();
        assert!(
            matches!(events.lock().unwrap().last(),Some(TranslationEvent::Completed{text,..}) if text == "# 你好")
        );
        mock.assert_async().await;
        mock.remove_async().await;
        state.start("cached".into()).unwrap();
        run_translation(&app, &state, request("cached", provider), &root, |e| {
            events.lock().unwrap().push(e);
            Ok(())
        })
        .await
        .unwrap();
        assert!(matches!(
            events.lock().unwrap().last(),
            Some(TranslationEvent::Completed { .. })
        ));
        let cache_file = std::fs::read_dir(root.join("translations"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let mock = server.mock("POST", "/v1/chat/completions").with_status(200)
            .with_header("content-type","text/event-stream")
            .with_body("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"},\"finish_reason\":\"length\"}]}\n\ndata: [DONE]\n\n").create_async().await;
        state.start("retry".into()).unwrap();
        let mut retry = request("retry", provider);
        retry.force = true;
        run_translation(&app, &state, retry, &root, |e| {
            events.lock().unwrap().push(e);
            Ok(())
        })
        .await
        .unwrap();
        assert!(
            matches!(events.lock().unwrap().last(),Some(TranslationEvent::Failed{code,..}) if code == "truncated")
        );
        assert_eq!(std::fs::read_to_string(&cache_file).unwrap(), "# 你好");
        assert_eq!(
            std::fs::read_to_string(source.join("references/guide.md")).unwrap(),
            "# Hello"
        );
        mock.assert_async().await;
        state.start("mismatch".into()).unwrap();
        let mut changed = request("mismatch", provider);
        changed.source = "draft".into();
        run_translation(&app, &state, changed, &root, |e| {
            events.lock().unwrap().push(e);
            Ok(())
        })
        .await
        .unwrap();
        assert!(
            matches!(events.lock().unwrap().last(),Some(TranslationEvent::Failed{code,..}) if code == "sourceChanged")
        );
        assert!(state.runtime.lock().unwrap().tasks.is_empty());
    }
}
