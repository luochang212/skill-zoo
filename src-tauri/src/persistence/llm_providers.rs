//! LLM connections are separate from the desktop-owned skill protocol.
use super::atomic_write_private;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Protocol {
    AnthropicMessages,
    OpenaiChatCompletions,
    OpenaiResponses,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub enabled: bool,
    #[serde(default)]
    pub thinking: bool,
    pub max_output_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
}

// Intentionally no Debug: this structure holds credentials.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub protocol: Protocol,
    pub base_url: String,
    pub api_key: String,
    pub models: Vec<Model>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSummary {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub protocol: Protocol,
    pub base_url: String,
    pub has_api_key: bool,
    pub models: Vec<Model>,
}

impl From<&Provider> for ProviderSummary {
    fn from(p: &Provider) -> Self {
        Self {
            id: p.id.clone(),
            name: p.name.clone(),
            enabled: p.enabled,
            protocol: p.protocol,
            base_url: p.base_url.clone(),
            has_api_key: !p.api_key.is_empty(),
            models: p.models.clone(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUpdate {
    pub id: Option<String>,
    pub name: String,
    pub enabled: bool,
    pub protocol: Protocol,
    pub base_url: String,
    /// None means unchanged; an empty string explicitly clears the secret.
    pub api_key: Option<String>,
    pub models: Vec<Model>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderFile {
    pub schema_version: u32,
    pub providers: Vec<Provider>,
}

impl Default for ProviderFile {
    fn default() -> Self {
        Self {
            schema_version: 1,
            providers: vec![],
        }
    }
}

pub const LANGUAGES: &[&str] = &["zh-CN", "zh-TW", "en", "ja", "ko", "fr", "de", "es", "pt"];

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationPreferences {
    pub target_language: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    #[serde(default)]
    pub prefer_cached_translations: bool,
}

impl TranslationPreferences {
    pub fn validate(&self) -> Result<(), String> {
        if self
            .target_language
            .as_deref()
            .is_some_and(|l| !LANGUAGES.contains(&l))
        {
            return Err("targetLanguage".into());
        }
        if self.provider_id.is_some() != self.model_id.is_some() {
            return Err("modelId".into());
        }
        Ok(())
    }
}

pub fn load(path: &Path) -> Result<ProviderFile, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(ProviderFile::default()),
        Err(_) => return Err("configRead".into()),
    };
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "configCorrupt")?;
    if value.get("schemaVersion").and_then(|v| v.as_u64()) != Some(1) {
        return Err("configVersion".into());
    }
    let mut file: ProviderFile = serde_json::from_value(value).map_err(|_| "configCorrupt")?;
    let mut ids = HashSet::new();
    for p in &mut file.providers {
        if !ids.insert(p.id.clone()) || p.id.is_empty() {
            return Err("configCorrupt".into());
        }
        validate(p).map_err(|_| "configCorrupt")?;
    }
    Ok(file)
}

pub fn save(path: &Path, file: &ProviderFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| "configWrite")?;
    }
    atomic_write_private(
        path,
        serde_json::to_vec_pretty(file).map_err(|_| "configWrite")?,
    )
    .map_err(|_| "configWrite".into())
}

pub fn validate(p: &mut Provider) -> Result<(), String> {
    p.name = p.name.trim().into();
    if p.name.is_empty() {
        return Err("name".into());
    }
    let mut url = url::Url::parse(p.base_url.trim()).map_err(|_| "baseUrl")?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("baseUrl".into());
    }
    if !url.path().ends_with('/') {
        url.set_path(&format!("{}/", url.path()));
    }
    p.base_url = url.to_string();
    if !p.api_key.is_empty() && reqwest::header::HeaderValue::from_str(&p.api_key).is_err() {
        return Err("apiKey".into());
    }
    let mut ids = HashSet::new();
    for model in &mut p.models {
        model.id = model.id.trim().into();
        if model.id.is_empty()
            || !ids.insert(model.id.clone())
            || model.max_output_tokens == Some(0)
            || model.context_window == Some(0)
            || matches!((model.context_window, model.max_output_tokens), (Some(context), Some(output)) if output > context)
        {
            return Err("models".into());
        }
    }
    Ok(())
}

pub fn upsert(path: &Path, update: ProviderUpdate) -> Result<Vec<ProviderSummary>, String> {
    let mut file = load(path)?;
    let existing = update
        .id
        .as_ref()
        .and_then(|id| file.providers.iter().position(|p| &p.id == id));
    if update.id.is_some() && existing.is_none() {
        return Err("providerMissing".into());
    }
    let previous = existing.map(|i| &file.providers[i]);
    let mut p = Provider {
        id: update
            .id
            .unwrap_or_else(|| format!("{:032x}", rand::random::<u128>())),
        name: update.name,
        enabled: update.enabled,
        protocol: update.protocol,
        base_url: update.base_url,
        api_key: update
            .api_key
            .unwrap_or_else(|| previous.map(|p| p.api_key.clone()).unwrap_or_default()),
        models: update.models,
    };
    validate(&mut p)?;
    if let Some(i) = existing {
        file.providers[i] = p;
    } else {
        file.providers.push(p);
    }
    save(path, &file)?;
    Ok(file.providers.iter().map(ProviderSummary::from).collect())
}

/// Recovery never overwrites a future schema. A unique private backup survives restart.
pub fn recover(path: &Path) -> Result<(), String> {
    match load(path) {
        Err(e) if e == "configCorrupt" => {}
        _ => return Err("recoveryUnavailable".into()),
    }
    let backup = PathBuf::from(format!(
        "{}.{}.backup",
        path.display(),
        rand::random::<u64>()
    ));
    let bytes = std::fs::read(path).map_err(|_| "configRead")?;
    atomic_write_private(&backup, bytes).map_err(|_| "configWrite")?;
    save(path, &ProviderFile::default())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cached_translation_preference_defaults_off_and_round_trips() {
        let mut prefs: TranslationPreferences = serde_json::from_value(serde_json::json!({
            "targetLanguage":"zh-CN", "providerId":"p", "modelId":"m"
        }))
        .unwrap();
        assert!(!prefs.prefer_cached_translations);
        prefs.prefer_cached_translations = true;
        let restored: TranslationPreferences =
            serde_json::from_slice(&serde_json::to_vec(&prefs).unwrap()).unwrap();
        assert!(restored.prefer_cached_translations);
        assert_eq!(restored.model_id.as_deref(), Some("m"));
    }
    fn update(id: Option<String>) -> ProviderUpdate {
        ProviderUpdate {
            id,
            name: "Local".into(),
            enabled: true,
            protocol: Protocol::OpenaiChatCompletions,
            base_url: "http://localhost:11434/v1".into(),
            api_key: Some("secret-key".into()),
            models: vec![Model {
                thinking: false,
                id: "test".into(),
                enabled: true,
                max_output_tokens: None,
                context_window: None,
            }],
        }
    }
    #[test]
    fn summaries_omit_secrets_and_unchanged_updates_preserve_them() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("providers.json");
        let result = upsert(&path, update(None)).unwrap();
        let summary = serde_json::to_string(&result).unwrap();
        assert!(!summary.contains("secret-key"));
        assert_eq!(result[0].base_url, "http://localhost:11434/v1/");
        let mut edit = update(Some(result[0].id.clone()));
        edit.api_key = None;
        upsert(&path, edit).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.providers[0].api_key, "secret-key");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
    #[test]
    fn invalid_updates_and_future_versions_never_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("providers.json");
        upsert(&path, update(None)).unwrap();
        let before = std::fs::read(&path).unwrap();
        let mut bad = update(None);
        bad.models.push(bad.models[0].clone());
        assert!(upsert(&path, bad).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::write(&path, r#"{"schemaVersion":99,"unknown":"preserve"}"#).unwrap();
        assert!(matches!(load(&path), Err(e) if e == "configVersion"));
        assert!(recover(&path).is_err());
        assert!(std::fs::read_to_string(&path).unwrap().contains("preserve"));
    }
    #[test]
    fn corrupt_recovery_preserves_original_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("providers.json");
        std::fs::write(&path, "broken secret").unwrap();
        assert!(upsert(&path, update(None)).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "broken secret");
        recover(&path).unwrap();
        assert!(load(&path).unwrap().providers.is_empty());
        let backup = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .find(|e| e.path().extension().is_some_and(|v| v == "backup"))
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(backup.path()).unwrap(),
            "broken secret"
        );
    }
    #[test]
    fn model_limits_are_backward_compatible_and_invalid_edits_preserve_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("providers.json");
        let saved = upsert(&path, update(None)).unwrap();
        assert!(!std::fs::read_to_string(&path)
            .unwrap()
            .contains("contextWindow"));
        let mut edit = update(Some(saved[0].id.clone()));
        edit.models[0].context_window = Some(1000);
        edit.models[0].max_output_tokens = Some(300);
        upsert(&path, edit).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.providers[0].models[0].context_window, Some(1000));
        let before = std::fs::read(&path).unwrap();
        for (context, output) in [(0, 1), (100, 101)] {
            let mut invalid = update(Some(saved[0].id.clone()));
            invalid.models[0].context_window = Some(context);
            invalid.models[0].max_output_tokens = Some(output);
            assert!(upsert(&path, invalid).is_err());
            assert_eq!(std::fs::read(&path).unwrap(), before);
        }
    }

    #[test]
    fn thinking_defaults_off_for_old_models_and_persists_an_explicit_choice() {
        let model: Model = serde_json::from_value(serde_json::json!({
            "id":"deepseek-flash", "enabled":true, "maxOutputTokens":null
        }))
        .unwrap();
        assert!(!model.thinking);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("providers.json");
        let mut draft = update(None);
        draft.models[0].thinking = true;
        let summaries = upsert(&path, draft).unwrap();
        assert!(summaries[0].models[0].thinking);
        assert!(load(&path).unwrap().providers[0].models[0].thinking);
    }
    #[test]
    fn legacy_headers_are_ignored_and_not_exposed_or_persisted_again() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("providers.json");
        let result = upsert(&path, update(None)).unwrap();
        let mut value = serde_json::to_value(load(&path).unwrap()).unwrap();
        value["providers"][0]["headers"] = serde_json::json!({"x-custom":"legacy-secret"});
        std::fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        let loaded = load(&path).unwrap();
        assert!(!serde_json::to_string(&loaded)
            .unwrap()
            .contains("legacy-secret"));
        let summary = serde_json::to_value(ProviderSummary::from(&loaded.providers[0])).unwrap();
        assert!(summary.get("headerNames").is_none());
        upsert(&path, update(Some(result[0].id.clone()))).unwrap();
        assert!(!std::fs::read_to_string(&path).unwrap().contains("headers"));
    }
}
