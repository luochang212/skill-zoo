#![allow(dead_code)]
mod persistence {
    pub mod llm_providers {
        pub struct Model {
            pub id: String,
            pub max_output_tokens: Option<u32>,
        }
        pub struct Provider {
            pub protocol: u8,
            pub base_url: String,
        }
    }
}
mod translation {
    include!(concat!(
        env!("SKILL_ZOO_ROOT"),
        "/src-tauri/src/services/translation.rs"
    ));
}
use std::io::{self, BufRead};
fn main() {
    for line in io::stdin().lock().lines() {
        let v: serde_json::Value = serde_json::from_str(&line.unwrap()).unwrap();
        let source = v["source"].as_str().unwrap();
        let language = v["language"].as_str().unwrap_or("Simplified Chinese");
        let p = translation::ProtectedMarkdown::new(source);
        let mut result = serde_json::json!({"input":p.input,"prompt":translation::system_prompt(language),"parts":p.parts});
        if let Some(raw) = v["raw"].as_str() {
            result["restored"] = serde_json::json!(p.restore(raw).ok());
            let plan = p.repair_plan(raw);
            result["repair_input"] = serde_json::json!(translation::repair_input(&plan.fragments));
            result["repair_prompt"] =
                serde_json::json!(translation::repair_system_prompt(language));
            result["repair_fragments"] = serde_json::json!(plan.fragments.len());
            if let Some(repaired) = v["repaired"].as_str() {
                let spliced = translation::parse_translations(repaired, plan.fragments.len())
                    .and_then(|pieces| p.splice(raw, &plan, &pieces).ok());
                result["spliced"] = serde_json::json!(spliced);
                result["repaired_restored"] =
                    serde_json::json!(spliced.and_then(|s| p.restore(&s).ok()));
            }
        }
        println!("{}", result);
    }
}
