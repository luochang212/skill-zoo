#![allow(dead_code)]
mod error { #[derive(Debug)] pub enum AppError { Io(std::io::Error), Parse(String), BadRequest(String) } }
mod config { pub fn get_agent_lock_file()->std::path::PathBuf { panic!("real home must never be used") } }
mod persistence { pub fn atomic_write(path:&std::path::Path,s:&str)->std::io::Result<()> { std::fs::write(path,s) } }
#[path="/Users/alex/Documents/GitHub/skill-zoo/src-tauri/src/services/lock.rs"] mod lock;
fn main(){
 let input=r#"{"version":3,"skills":{"demo":{"source":"cli/cli","sourceType":"github","sourceUrl":"https://github.com/cli/cli.git","skillPath":"skills/demo/SKILL.md","skillFolderHash":"gh-tree","installedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","pinnedRef":"v1.0.0"}}}"#;
 let parsed:lock::SkillLock=serde_json::from_str(input).unwrap();
 let output=std::path::Path::new("/tmp/gh-skill-review.mM0tji/rust-roundtrip.json");parsed.write_to(output).unwrap();
 let v:serde_json::Value=serde_json::from_str(&std::fs::read_to_string(output).unwrap()).unwrap();
 println!("Rust production SkillLock roundtrip: {}",v);
 assert!(v["skills"]["demo"].get("pinnedRef").is_none());assert!(v["skills"]["demo"]["commitSha"].is_null());
}
