use crate::error::{self, AppError};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgent {
    pub id: String,
    pub label: String,
    pub skills_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentRegistry {
    pub version: u32,
    #[serde(default)]
    pub agents: Vec<CustomAgent>,
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self {
            version: 1,
            agents: Vec::new(),
        }
    }
}

impl AgentRegistry {
    pub fn load_from(path: &Path) -> Result<Self, AppError> {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(e) => return Err(error::io(path, e)),
        };
        Self::parse(&bytes)
    }

    pub fn parse(bytes: &[u8]) -> Result<Self, AppError> {
        // Inspect the version before decoding fields so future versions give
        // an upgrade instruction even when their shape differs from v1.
        let value: serde_json::Value = serde_json::from_slice(bytes)
            .map_err(|e| AppError::Parse(format!("agents.json: {e}")))?;
        if value
            .get("version")
            .and_then(|v| v.as_u64())
            .is_some_and(|v| v > 1)
        {
            return Err(AppError::BadRequest(
                "Upgrade Skill Zoo to read this agent registry".into(),
            ));
        }
        let registry: Self = serde_json::from_value(value)
            .map_err(|e| AppError::Parse(format!("agents.json: {e}")))?;
        registry.validate()?;
        Ok(registry)
    }

    pub fn validate(&self) -> Result<(), AppError> {
        if self.version != 1 {
            return Err(AppError::BadRequest(
                "Unsupported agent registry version".into(),
            ));
        }
        let mut ids = HashSet::new();
        let mut labels: HashSet<String> = HashSet::new();
        for agent in &self.agents {
            let suffix = agent.id.strip_prefix("custom-").unwrap_or_default();
            if suffix.len() != 36
                || !suffix.chars().enumerate().all(|(i, c)| {
                    if [8, 13, 18, 23].contains(&i) {
                        c == '-'
                    } else {
                        c.is_ascii_hexdigit()
                    }
                })
                || !ids.insert(&agent.id)
            {
                return Err(AppError::BadRequest(
                    "Invalid or duplicate custom agent ID".into(),
                ));
            }
            if agent.label.trim() != agent.label
                || agent.label.is_empty()
                || agent.label.chars().count() > 64
                || !labels.insert(agent.label.to_lowercase())
            {
                return Err(AppError::BadRequest(
                    "Invalid or duplicate agent name".into(),
                ));
            }
            if !agent.skills_dir.is_absolute() {
                return Err(AppError::BadRequest(
                    "Agent Skills directory must be absolute".into(),
                ));
            }
        }
        Ok(())
    }

    pub fn save_to(&self, path: &Path) -> Result<(), AppError> {
        // Never replace a corrupt or newer file with a fresh default.
        Self::load_from(path)?;
        self.validate()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| error::io(parent, e))?;
        }
        let bytes = serde_json::to_vec_pretty(self).map_err(|e| AppError::Parse(e.to_string()))?;
        super::atomic_write(path, bytes).map_err(|e| error::io(path, e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_registry_fixtures() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/local-protocol");
        let full_name = if cfg!(windows) {
            "agents-v1-windows-full.json"
        } else {
            "agents-v1-full.json"
        };
        let full = AgentRegistry::load_from(&root.join(full_name)).unwrap();
        assert_eq!(full.agents[0].label, "Custom Tool");
        assert!(
            AgentRegistry::load_from(&root.join("agents-v1-minimal.json"))
                .unwrap()
                .agents
                .is_empty()
        );
        for file in ["agents-v2-future.json", "agents-v1-invalid.json"] {
            assert!(AgentRegistry::load_from(&root.join(file)).is_err());
        }
    }

    #[test]
    fn absent_is_empty_but_invalid_is_never_overwritten() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("agents.json");
        assert!(AgentRegistry::load_from(&path).unwrap().agents.is_empty());
        for bytes in [b"{broken".as_slice(), b"{\"version\":2}".as_slice()] {
            std::fs::write(&path, bytes).unwrap();
            assert!(AgentRegistry::default().save_to(&path).is_err());
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
    }
}
