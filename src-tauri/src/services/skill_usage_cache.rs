use super::skill_usage::{self, SkillUsage};
use crate::store::AppState;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

pub const AGENT_SETTING: &str = "skill_usage_agent";
const MAX_AGE: Duration = Duration::from_secs(30);

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub usage: Option<SkillUsage>,
    #[serde(skip)]
    pub loading: bool,
    pub error: Option<String>,
    #[serde(skip)]
    checked_at: Option<Instant>,
}

impl UsageSnapshot {
    pub fn from_usage(usage: SkillUsage) -> Self {
        Self {
            usage: Some(usage),
            ..Self::default()
        }
    }
    fn result(&self) -> Result<SkillUsage, String> {
        match (&self.error, &self.usage) {
            (Some(error), _) => Err(error.clone()),
            (_, Some(usage)) => Ok(usage.clone()),
            _ => Err("Usage has not been loaded".into()),
        }
    }
}

#[derive(Default)]
struct Entry {
    snapshot: Mutex<UsageSnapshot>,
    scan: tokio::sync::Mutex<()>,
}

#[derive(Default)]
pub struct SkillUsageCache {
    entries: Mutex<HashMap<String, Arc<Entry>>>,
}

impl SkillUsageCache {
    fn entry(&self, agent: &str) -> Arc<Entry> {
        self.entries
            .lock()
            .unwrap()
            .entry(agent.into())
            .or_default()
            .clone()
    }

    pub fn snapshot(&self, agent: &str) -> UsageSnapshot {
        self.entry(agent).snapshot.lock().unwrap().clone()
    }

    pub async fn load(
        &self,
        agent: String,
        whitelist: HashSet<String>,
        count: usize,
    ) -> Result<SkillUsage, String> {
        self.load_with(agent.clone(), move || {
            skill_usage::discover_skill_usage(&agent, whitelist, count)
        })
        .await
    }

    async fn load_with(
        &self,
        agent: String,
        scan: impl FnOnce() -> Result<SkillUsage, String> + Send + 'static,
    ) -> Result<SkillUsage, String> {
        let requested_at = Instant::now();
        let entry = self.entry(&agent);
        let _scan = entry.scan.lock().await;
        {
            let mut snapshot = entry.snapshot.lock().unwrap();
            if snapshot.checked_at.is_some_and(|at| {
                at >= requested_at || (snapshot.error.is_none() && at.elapsed() < MAX_AGE)
            }) {
                return snapshot.result();
            }
            snapshot.loading = true;
        }
        let result = tokio::task::spawn_blocking(scan)
            .await
            .unwrap_or_else(|_| Err("Usage scan failed".into()));
        let mut snapshot = entry.snapshot.lock().unwrap();
        snapshot.loading = false;
        snapshot.checked_at = Some(Instant::now());
        snapshot.error = result.as_ref().err().cloned();
        if let Ok(usage) = &result {
            snapshot.usage = Some(usage.clone());
        }
        result
    }
}

fn resolve_agent(saved: Option<&str>, agents: &[crate::config::AgentConfig]) -> String {
    let tracked = |agent: &&crate::config::AgentConfig| agent.has_usage_tracking;
    agents
        .iter()
        .filter(tracked)
        .find(|a| Some(a.id.as_str()) == saved)
        .or_else(|| agents.iter().filter(tracked).find(|a| a.id == "codex"))
        .or_else(|| agents.iter().find(|a| a.has_usage_tracking))
        .map(|a| a.id.clone())
        .unwrap_or_else(|| "codex".into())
}

pub fn selected_agent(app: &AppHandle) -> String {
    let state = app.state::<AppState>();
    let settings = state.settings.lock().unwrap();
    resolve_agent(
        settings.get(AGENT_SETTING).map(String::as_str),
        &crate::config::agents(),
    )
}

pub async fn load_usage(app: &AppHandle, agent: String) -> Result<SkillUsage, String> {
    let (whitelist, count) = {
        let state = app.state::<AppState>();
        let cache = state
            .skill_cache
            .read()
            .map_err(|_| "Could not read installed skills")?;
        skill_usage::skill_whitelist(&cache, &agent)
    };
    if !skill_usage::supports_agent(&agent) {
        return skill_usage::discover_skill_usage(&agent, whitelist, count);
    }
    let before = app.state::<SkillUsageCache>().snapshot(&agent).checked_at;
    let result = app
        .state::<SkillUsageCache>()
        .load(agent.clone(), whitelist, count)
        .await;
    if app.state::<SkillUsageCache>().snapshot(&agent).checked_at != before {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let _ = super::tray::refresh_recent_skills_menu(&handle);
        });
    }
    result
}

pub fn refresh_selected(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let agent = selected_agent(&app);
        let _ = load_usage(&app, agent).await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn usage(calls: u64) -> SkillUsage {
        SkillUsage {
            installed_skill_count: 1,
            total_calls: calls,
            source_counts: Default::default(),
            week: Default::default(),
            month: Default::default(),
            recent: vec![],
        }
    }

    #[test]
    fn selection_uses_the_same_available_sources_and_defaults_as_the_dialog() {
        let mut agents = crate::config::AGENTS.clone();
        for agent in &mut agents {
            agent.has_usage_tracking = skill_usage::supports_agent(&agent.id);
        }
        assert_eq!(resolve_agent(Some("zcode"), &agents), "zcode");
        assert_eq!(resolve_agent(None, &agents), "codex");
        agents.retain(|a| a.id != "zcode" && a.id != "codex");
        assert_eq!(resolve_agent(Some("zcode"), &agents), "claude-code");
        assert_eq!(resolve_agent(None, &[]), "codex");
    }

    #[tokio::test]
    async fn concurrent_views_share_a_scan_and_other_agents_remain_independent() {
        let cache = Arc::new(SkillUsageCache::default());
        let (started, ready) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let first_cache = cache.clone();
        let first = tokio::spawn(async move {
            first_cache
                .load_with("zcode".into(), move || {
                    started.send(()).unwrap();
                    wait.recv().unwrap();
                    Ok(usage(7))
                })
                .await
                .unwrap()
        });
        ready.await.unwrap();
        assert!(cache.snapshot("zcode").loading);
        assert_eq!(
            cache
                .load_with("codex".into(), || Ok(usage(3)))
                .await
                .unwrap()
                .total_calls,
            3
        );
        assert!(cache.snapshot("claude-code").usage.is_none());
        let second_cache = cache.clone();
        let second = tokio::spawn(async move {
            second_cache
                .load_with("zcode".into(), || panic!("duplicate scan"))
                .await
                .unwrap()
        });
        tokio::task::yield_now().await;
        release.send(()).unwrap();
        assert_eq!(first.await.unwrap().total_calls, 7);
        assert_eq!(second.await.unwrap().total_calls, 7);
        assert_eq!(
            cache
                .load_with("zcode".into(), || panic!("fresh cache scanned"))
                .await
                .unwrap()
                .total_calls,
            7
        );
    }

    #[tokio::test]
    async fn concurrent_read_failures_are_shared_without_a_second_scan() {
        let cache = Arc::new(SkillUsageCache::default());
        let (started, ready) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let first_cache = cache.clone();
        let first = tokio::spawn(async move {
            first_cache
                .load_with("zcode".into(), move || {
                    started.send(()).unwrap();
                    wait.recv().unwrap();
                    Err("unreadable".into())
                })
                .await
        });
        ready.await.unwrap();
        let (requested, queued) = tokio::sync::oneshot::channel();
        let second = tokio::spawn(async move {
            requested.send(()).unwrap();
            cache
                .load_with("zcode".into(), || panic!("duplicate failed scan"))
                .await
        });
        queued.await.unwrap();
        release.send(()).unwrap();
        assert_eq!(first.await.unwrap().unwrap_err(), "unreadable");
        assert_eq!(second.await.unwrap().unwrap_err(), "unreadable");
    }

    #[tokio::test]
    async fn failed_refresh_retains_only_that_agents_old_result_and_allows_retry() {
        let cache = SkillUsageCache::default();
        cache
            .load_with("zcode".into(), || Ok(usage(7)))
            .await
            .unwrap();
        cache.entry("zcode").snapshot.lock().unwrap().checked_at = Some(Instant::now() - MAX_AGE);
        assert!(cache
            .load_with("zcode".into(), || Err("unreadable".into()))
            .await
            .is_err());
        let snapshot = cache.snapshot("zcode");
        assert_eq!(snapshot.usage.unwrap().total_calls, 7);
        assert_eq!(snapshot.error.as_deref(), Some("unreadable"));
        assert!(!snapshot.loading);
        assert!(cache.snapshot("codex").usage.is_none());
        assert_eq!(
            cache
                .load_with("zcode".into(), || Ok(usage(8)))
                .await
                .unwrap()
                .total_calls,
            8
        );
        assert!(cache.snapshot("zcode").error.is_none());
    }
}
