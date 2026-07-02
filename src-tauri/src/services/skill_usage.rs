use crate::persistence::SkillCache;
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, TimeZone, Weekday};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

const RECENT_LIMIT: usize = 5;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillUsageRank {
    pub name: String,
    pub count: u64,
    pub last_used_at: i64,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillUsagePeriod {
    pub total_calls: u64,
    pub skills: Vec<SkillUsageRank>,
    pub daily_breakdown: Vec<DailyCount>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DailyCount {
    pub label: String,
    pub date: String,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentSkillUsage {
    pub name: String,
    pub command: String,
    pub last_used_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSkillUsage {
    pub installed_skill_count: usize,
    pub total_calls: u64,
    pub week: SkillUsagePeriod,
    pub month: SkillUsagePeriod,
    pub all: SkillUsagePeriod,
    pub recent: Vec<RecentSkillUsage>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SkillUsageEvent {
    name: String,
    ts_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedSkillLine {
    id: Option<String>,
    ts_ms: i64,
    skills: Vec<String>,
}

pub fn claude_skill_whitelist(cache: &SkillCache) -> (HashSet<String>, usize) {
    let mut whitelist = HashSet::new();
    let mut installed_skill_count = 0;
    for skill in cache.skills() {
        let is_claude_skill = skill.apps.get("claude-code").copied().unwrap_or(false)
            || skill.home_agent.as_deref() == Some("claude-code");
        if !is_claude_skill {
            continue;
        }
        installed_skill_count += 1;
        insert_skill_alias(&mut whitelist, &skill.name);
        insert_skill_alias(&mut whitelist, &skill.directory);
        if let Some(yaml_name) = &skill.yaml_name {
            insert_skill_alias(&mut whitelist, yaml_name);
        }
    }
    if whitelist.is_empty() {
        if let Some(home) = dirs::home_dir() {
            installed_skill_count =
                scan_skill_dir_names(&home.join(".claude").join("skills"), &mut whitelist);
        }
    }
    (whitelist, installed_skill_count)
}

pub fn discover_claude_skill_usage(
    whitelist: HashSet<String>,
    installed_skill_count: usize,
) -> ClaudeSkillUsage {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    discover_claude_skill_usage_from_home(&home, whitelist, installed_skill_count, Local::now())
}

fn discover_claude_skill_usage_from_home(
    home: &Path,
    whitelist: HashSet<String>,
    installed_skill_count: usize,
    now: DateTime<Local>,
) -> ClaudeSkillUsage {
    let mut effective_whitelist = whitelist;
    let mut effective_installed_skill_count = installed_skill_count;
    if effective_whitelist.is_empty() {
        effective_installed_skill_count = scan_skill_dir_names(
            &home.join(".claude").join("skills"),
            &mut effective_whitelist,
        );
    }

    let mut events = Vec::new();
    let mut files = Vec::new();
    collect_jsonl_files(&home.join(".claude").join("projects"), &mut files);

    let mut seen = HashSet::new();
    for path in files {
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        for line in content.lines() {
            let Some(parsed) = parse_skill_line(line) else {
                continue;
            };
            for raw_skill in parsed.skills {
                let Some(name) = normalize_skill_name(&raw_skill) else {
                    continue;
                };
                if !effective_whitelist.contains(&name) {
                    continue;
                }
                if let Some(id) = &parsed.id {
                    if !seen.insert((id.clone(), name.clone())) {
                        continue;
                    }
                }
                events.push(SkillUsageEvent {
                    name,
                    ts_ms: parsed.ts_ms,
                });
            }
        }
    }

    build_usage(effective_installed_skill_count, events, now)
}

fn build_usage(
    installed_skill_count: usize,
    mut events: Vec<SkillUsageEvent>,
    now: DateTime<Local>,
) -> ClaudeSkillUsage {
    events.sort_by(|a, b| b.ts_ms.cmp(&a.ts_ms));
    let total_calls = events.len() as u64;
    let week = period_report(&events, Period::Week, now);
    let month = period_report(&events, Period::Month, now);
    let all = period_report(&events, Period::All, now);
    let recent = recent_skills(&events);

    ClaudeSkillUsage {
        installed_skill_count,
        total_calls,
        week,
        month,
        all,
        recent,
    }
}

#[derive(Debug, Clone, Copy)]
enum Period {
    Week,
    Month,
    All,
}

fn period_report(
    events: &[SkillUsageEvent],
    period: Period,
    now: DateTime<Local>,
) -> SkillUsagePeriod {
    let threshold = match period {
        Period::Week => Some(now - Duration::days(7)),
        Period::Month => Some(now - Duration::days(30)),
        Period::All => None,
    };

    let mut counts: HashMap<String, (u64, i64)> = HashMap::new();
    let mut daily: HashMap<NaiveDate, u64> = HashMap::new();
    let mut total_calls = 0;
    for event in events {
        let Some(ts) = Local.timestamp_millis_opt(event.ts_ms).single() else {
            continue;
        };
        if let Some(cutoff) = threshold {
            if ts < cutoff {
                continue;
            }
        }
        total_calls += 1;
        let entry = counts.entry(event.name.clone()).or_default();
        entry.0 += 1;
        entry.1 = entry.1.max(event.ts_ms);
        *daily.entry(ts.date_naive()).or_default() += 1;
    }

    let daily_breakdown = match period {
        Period::Week | Period::Month => {
            let days = match period {
                Period::Week => 7,
                Period::Month => 30,
                _ => unreachable!(),
            };
            let today = now.date_naive();
            let start = today - Duration::days(days as i64 - 1);
            (0..days)
                .map(|i| {
                    let date = start + Duration::days(i as i64);
                    let label = match period {
                        Period::Week => weekday_label(date.weekday()),
                        Period::Month => {
                            if i == 0 || (i + 1) % 5 == 0 {
                                date.format("%m-%d").to_string()
                            } else {
                                String::new()
                            }
                        }
                        _ => unreachable!(),
                    };
                    DailyCount {
                        label,
                        date: date.format("%m-%d").to_string(),
                        count: daily.get(&date).copied().unwrap_or(0),
                    }
                })
                .collect()
        }
        Period::All => Vec::new(),
    };

    SkillUsagePeriod {
        total_calls,
        skills: ranked_counts(counts),
        daily_breakdown,
    }
}

fn ranked_counts(counts: HashMap<String, (u64, i64)>) -> Vec<SkillUsageRank> {
    let mut ranks: Vec<_> = counts
        .into_iter()
        .map(|(name, (count, last_used_at))| SkillUsageRank {
            name,
            count,
            last_used_at,
        })
        .collect();
    ranks.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| b.last_used_at.cmp(&a.last_used_at))
            .then_with(|| a.name.cmp(&b.name))
    });
    ranks
}

fn recent_skills(events: &[SkillUsageEvent]) -> Vec<RecentSkillUsage> {
    let mut seen = HashSet::new();
    let mut recent = Vec::new();
    for event in events {
        if !seen.insert(event.name.clone()) {
            continue;
        }
        recent.push(RecentSkillUsage {
            name: event.name.clone(),
            command: event.name.clone(),
            last_used_at: event.ts_ms,
        });
        if recent.len() == RECENT_LIMIT {
            break;
        }
    }
    recent
}

fn parse_skill_line(line: &str) -> Option<ParsedSkillLine> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    match value.get("type")?.as_str()? {
        "assistant" => parse_assistant_skill_line(&value),
        "user" => parse_user_command_line(&value),
        _ => None,
    }
}

fn parse_assistant_skill_line(value: &serde_json::Value) -> Option<ParsedSkillLine> {
    let ts_ms = timestamp_ms(value)?;
    let message = value.get("message")?;
    let id = message
        .get("id")
        .and_then(|id| id.as_str())
        .filter(|id| !id.is_empty())
        .map(str::to_string);
    let mut skills = Vec::new();
    for block in message.get("content")?.as_array()? {
        if block.get("type").and_then(|kind| kind.as_str()) != Some("tool_use") {
            continue;
        }
        if block.get("name").and_then(|name| name.as_str()) != Some("Skill") {
            continue;
        }
        if let Some(skill) = block
            .get("input")
            .and_then(|input| input.get("skill"))
            .and_then(|skill| skill.as_str())
            .filter(|skill| !skill.trim().is_empty())
        {
            skills.push(skill.to_string());
        }
    }
    if skills.is_empty() {
        return None;
    }
    Some(ParsedSkillLine { id, ts_ms, skills })
}

fn parse_user_command_line(value: &serde_json::Value) -> Option<ParsedSkillLine> {
    let text = value
        .get("message")?
        .get("content")
        .and_then(|content| content.as_str())?;
    let raw = extract_tag(text, "command-name")?;
    let skill = raw.trim().trim_start_matches('/').trim();
    if skill.is_empty() {
        return None;
    }
    let ts_ms = timestamp_ms(value)?;
    let id = value
        .get("uuid")
        .and_then(|id| id.as_str())
        .filter(|id| !id.is_empty())
        .map(str::to_string);
    Some(ParsedSkillLine {
        id,
        ts_ms,
        skills: vec![skill.to_string()],
    })
}

fn timestamp_ms(value: &serde_json::Value) -> Option<i64> {
    DateTime::parse_from_rfc3339(value.get("timestamp")?.as_str()?)
        .ok()
        .map(|ts| ts.timestamp_millis())
}

fn extract_tag(text: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = text.find(&open)? + open.len();
    let rest = &text[start..];
    let end = rest.find(&close)?;
    Some(rest[..end].to_string())
}

fn insert_skill_alias(set: &mut HashSet<String>, value: &str) {
    if let Some(name) = normalize_skill_name(value) {
        set.insert(name);
    }
}

fn normalize_skill_name(value: &str) -> Option<String> {
    let name = value
        .trim()
        .trim_start_matches('/')
        .rsplit(':')
        .next()
        .unwrap_or(value)
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(value)
        .trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn scan_skill_dir_names(dir: &Path, set: &mut HashSet<String>) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut count = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || !path.join("SKILL.md").exists() {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
            count += 1;
            insert_skill_alias(set, name);
        }
    }
    count
}

fn weekday_label(w: Weekday) -> String {
    match w {
        Weekday::Mon => "Mon",
        Weekday::Tue => "Tue",
        Weekday::Wed => "Wed",
        Weekday::Thu => "Thu",
        Weekday::Fri => "Fri",
        Weekday::Sat => "Sat",
        Weekday::Sun => "Sun",
    }
    .to_string()
}

fn collect_jsonl_files(dir: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, files);
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_usage, discover_claude_skill_usage_from_home, normalize_skill_name, parse_skill_line,
        SkillUsageEvent,
    };
    use chrono::{Local, TimeZone};
    use std::collections::HashSet;

    #[test]
    fn parses_assistant_skill_tool_use() {
        let line = r#"{"type":"assistant","timestamp":"2026-07-02T10:00:00Z","message":{"id":"msg_1","content":[{"type":"tool_use","name":"Skill","input":{"skill":"plugin:code-review"}}]}}"#;
        let parsed = parse_skill_line(line).unwrap();
        assert_eq!(parsed.id.as_deref(), Some("msg_1"));
        assert_eq!(parsed.skills, vec!["plugin:code-review"]);
    }

    #[test]
    fn parses_user_command_tag() {
        let line = r#"{"type":"user","timestamp":"2026-07-02T10:00:00Z","uuid":"u1","message":{"content":"<command-name>/translate</command-name>hello"}}"#;
        let parsed = parse_skill_line(line).unwrap();
        assert_eq!(parsed.id.as_deref(), Some("u1"));
        assert_eq!(parsed.skills, vec!["translate"]);
    }

    #[test]
    fn normalizes_plugin_and_path_names() {
        assert_eq!(
            normalize_skill_name("plugin:code-review"),
            Some("code-review".to_string())
        );
        assert_eq!(
            normalize_skill_name("/Users/demo/skills/translate"),
            Some("translate".to_string())
        );
    }

    #[test]
    fn aggregates_periods_and_recent_skills() {
        let now = Local.with_ymd_and_hms(2026, 7, 2, 12, 0, 0).unwrap();
        let events = vec![
            SkillUsageEvent {
                name: "code-review".to_string(),
                ts_ms: now.timestamp_millis(),
            },
            SkillUsageEvent {
                name: "translate".to_string(),
                ts_ms: (now - chrono::Duration::hours(1)).timestamp_millis(),
            },
            SkillUsageEvent {
                name: "code-review".to_string(),
                ts_ms: (now - chrono::Duration::days(1)).timestamp_millis(),
            },
        ];
        let usage = build_usage(2, events, now);
        assert_eq!(usage.total_calls, 3);
        assert_eq!(usage.week.total_calls, 3);
        assert_eq!(usage.week.skills[0].name, "code-review");
        assert_eq!(usage.week.skills[0].count, 2);
        assert_eq!(usage.recent[0].command, "code-review");
        assert_eq!(usage.recent[1].command, "translate");
    }

    #[test]
    fn discovers_claude_logs_with_whitelist_filtering() {
        let temp = tempfile::tempdir().unwrap();
        let project_dir = temp.path().join(".claude/projects/demo");
        std::fs::create_dir_all(&project_dir).unwrap();
        std::fs::write(
            project_dir.join("session.jsonl"),
            [
                r#"{"type":"user","timestamp":"2026-07-02T10:00:00Z","uuid":"u1","message":{"content":"<command-name>/code-review</command-name>review"}}"#,
                r#"{"type":"user","timestamp":"2026-07-02T11:00:00Z","uuid":"u2","message":{"content":"<command-name>/Users/demo</command-name>"}}"#,
            ]
            .join("\n"),
        )
        .unwrap();
        let whitelist = HashSet::from(["code-review".to_string()]);
        let now = Local.with_ymd_and_hms(2026, 7, 2, 12, 0, 0).unwrap();
        let usage = discover_claude_skill_usage_from_home(temp.path(), whitelist, 1, now);
        assert_eq!(usage.total_calls, 1);
        assert_eq!(usage.installed_skill_count, 1);
        assert_eq!(usage.recent[0].name, "code-review");
    }
}
