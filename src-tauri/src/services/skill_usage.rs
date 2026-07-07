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
pub struct SkillUsage {
    pub installed_skill_count: usize,
    pub total_calls: u64,
    pub week: SkillUsagePeriod,
    pub month: SkillUsagePeriod,
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

pub fn skill_whitelist(cache: &SkillCache, agent_id: &str) -> (HashSet<String>, usize) {
    let mut whitelist = HashSet::new();
    let mut installed_skill_count = 0;
    for skill in cache.skills() {
        let belongs_to_agent = skill.apps.get(agent_id).copied().unwrap_or(false)
            || skill.home_agent.as_deref() == Some(agent_id);
        if !belongs_to_agent {
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
        if let Some(dir) = crate::config::get_agent_skills_dir(agent_id) {
            installed_skill_count = scan_skill_dir_names(&dir, &mut whitelist);
        }
    }
    (whitelist, installed_skill_count)
}

pub fn discover_skill_usage(
    agent_id: &str,
    whitelist: HashSet<String>,
    installed_skill_count: usize,
) -> SkillUsage {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    discover_skill_usage_from_home(
        agent_id,
        &home,
        whitelist,
        installed_skill_count,
        Local::now(),
    )
}

fn discover_skill_usage_from_home(
    agent_id: &str,
    home: &Path,
    whitelist: HashSet<String>,
    installed_skill_count: usize,
    now: DateTime<Local>,
) -> SkillUsage {
    match agent_id {
        "claude-code" => {
            discover_claude_usage_from_home(home, whitelist, installed_skill_count, now)
        }
        "codex" => discover_codex_usage_from_home(home, whitelist, installed_skill_count, now),
        _ => build_usage(installed_skill_count, Vec::new(), now),
    }
}

fn discover_claude_usage_from_home(
    home: &Path,
    whitelist: HashSet<String>,
    installed_skill_count: usize,
    now: DateTime<Local>,
) -> SkillUsage {
    let (whitelist, installed_skill_count) =
        effective_whitelist(home, "claude-code", whitelist, installed_skill_count);
    let mut files = Vec::new();
    collect_jsonl_files(&home.join(".claude").join("projects"), &mut files);
    let events = aggregate_events(&files, parse_claude_skill_line, &whitelist);
    build_usage(installed_skill_count, events, now)
}

fn discover_codex_usage_from_home(
    home: &Path,
    whitelist: HashSet<String>,
    installed_skill_count: usize,
    now: DateTime<Local>,
) -> SkillUsage {
    let (whitelist, installed_skill_count) =
        effective_whitelist(home, "codex", whitelist, installed_skill_count);
    let mut files = Vec::new();
    collect_jsonl_files(&home.join(".codex").join("sessions"), &mut files);
    let events = aggregate_events(&files, parse_codex_skill_line, &whitelist);
    build_usage(installed_skill_count, events, now)
}

/// When the in-memory cache yielded no whitelist, fall back to scanning the
/// agent's installed-skills directory on disk so usage still resolves.
fn effective_whitelist(
    home: &Path,
    agent_id: &str,
    whitelist: HashSet<String>,
    installed_skill_count: usize,
) -> (HashSet<String>, usize) {
    if !whitelist.is_empty() {
        return (whitelist, installed_skill_count);
    }
    let mut effective = HashSet::new();
    let dir = crate::config::get_agent_skills_dir(agent_id)
        .unwrap_or_else(|| home.join(".claude").join("skills"));
    let count = scan_skill_dir_names(&dir, &mut effective);
    (effective, count)
}

/// Walk the collected session files, parse each line, and keep one
/// `SkillUsageEvent` per (dedup id, normalized skill name) that survives the
/// whitelist. Agent-agnostic: the caller supplies the line parser.
fn aggregate_events(
    files: &[PathBuf],
    parse_line: impl Fn(&str) -> Option<ParsedSkillLine>,
    whitelist: &HashSet<String>,
) -> Vec<SkillUsageEvent> {
    let mut events = Vec::new();
    let mut seen = HashSet::new();
    for path in files {
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        for line in content.lines() {
            let Some(parsed) = parse_line(line) else {
                continue;
            };
            for raw_skill in parsed.skills {
                let Some(name) = normalize_skill_name(&raw_skill) else {
                    continue;
                };
                if !whitelist.contains(&name) {
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
    events
}

fn build_usage(
    installed_skill_count: usize,
    mut events: Vec<SkillUsageEvent>,
    now: DateTime<Local>,
) -> SkillUsage {
    events.sort_by_key(|b| std::cmp::Reverse(b.ts_ms));
    let total_calls = events.len() as u64;
    let week = period_report(&events, Period::Week, now);
    let month = period_report(&events, Period::Month, now);
    let recent = recent_skills(&events);

    SkillUsage {
        installed_skill_count,
        total_calls,
        week,
        month,
        recent,
    }
}

#[derive(Debug, Clone, Copy)]
enum Period {
    Week,
    Month,
}

fn period_report(
    events: &[SkillUsageEvent],
    period: Period,
    now: DateTime<Local>,
) -> SkillUsagePeriod {
    let today = now.date_naive();
    let start_date = match period {
        Period::Week => today - Duration::days(6),
        Period::Month => today - Duration::days(29),
    };

    let mut counts: HashMap<String, (u64, i64)> = HashMap::new();
    let mut daily: HashMap<NaiveDate, u64> = HashMap::new();
    let mut total_calls = 0;
    for event in events {
        let Some(ts) = Local.timestamp_millis_opt(event.ts_ms).single() else {
            continue;
        };
        let date = ts.date_naive();
        if date < start_date {
            continue;
        }
        total_calls += 1;
        let entry = counts.entry(event.name.clone()).or_default();
        entry.0 += 1;
        entry.1 = entry.1.max(event.ts_ms);
        *daily.entry(date).or_default() += 1;
    }

    let days = match period {
        Period::Week => 7,
        Period::Month => 30,
    };
    let daily_breakdown = (0..days)
        .map(|i| {
            let date = start_date + Duration::days(i as i64);
            let label = match period {
                Period::Week => weekday_label(date.weekday()),
                Period::Month => {
                    if i == 0 || (i + 1) % 5 == 0 {
                        date.format("%m-%d").to_string()
                    } else {
                        String::new()
                    }
                }
            };
            DailyCount {
                label,
                date: date.format("%m-%d").to_string(),
                count: daily.get(&date).copied().unwrap_or(0),
            }
        })
        .collect();

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

fn parse_claude_skill_line(line: &str) -> Option<ParsedSkillLine> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    match value.get("type")?.as_str()? {
        "assistant" => parse_assistant_skill_line(&value),
        "user" => parse_user_command_line(&value),
        _ => None,
    }
}

/// Codex records a skill activation as an `exec_command` tool call that reads
/// the skill's `SKILL.md` — it has no dedicated Skill tool like Claude Code.
/// Each such read counts as one usage of that skill.
fn parse_codex_skill_line(line: &str) -> Option<ParsedSkillLine> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let payload = match value.get("type")?.as_str()? {
        "response_item" => value.get("payload")?,
        _ => return None,
    };
    if payload.get("type").and_then(|t| t.as_str()) != Some("function_call") {
        return None;
    }
    if payload.get("name").and_then(|n| n.as_str()) != Some("exec_command") {
        return None;
    }
    // `arguments` is itself a JSON-encoded string:
    // {"cmd":"sed -n '1,Np' …/skills/<name>/SKILL.md", ...}
    let arguments_str = payload.get("arguments").and_then(|a| a.as_str())?;
    let args_value: serde_json::Value = serde_json::from_str(arguments_str).ok()?;
    let cmd = args_value.get("cmd").and_then(|c| c.as_str())?;
    let name = extract_skill_name_from_cmd(cmd)?;
    let ts_ms = timestamp_ms(&value)?;
    Some(ParsedSkillLine {
        id: None,
        ts_ms,
        skills: vec![name],
    })
}

/// Pull the skill name out of a command path like `…/skills/<name>/SKILL.md`,
/// regardless of prefix (absolute, relative, or `~`). Each read is a distinct
/// event, so no dedup id is needed.
static SKILL_FILE_RE: std::sync::LazyLock<regex::Regex> =
    std::sync::LazyLock::new(|| regex::Regex::new(r"(?i)skills/([^/]+)/SKILL\.md").unwrap());

fn extract_skill_name_from_cmd(text: &str) -> Option<String> {
    SKILL_FILE_RE
        .captures(text)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
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
        build_usage, discover_claude_usage_from_home, discover_codex_usage_from_home,
        normalize_skill_name, parse_claude_skill_line, parse_codex_skill_line, SkillUsageEvent,
    };
    use chrono::{Local, TimeZone};
    use std::collections::HashSet;

    #[test]
    fn parses_assistant_skill_tool_use() {
        let line = r#"{"type":"assistant","timestamp":"2026-07-02T10:00:00Z","message":{"id":"msg_1","content":[{"type":"tool_use","name":"Skill","input":{"skill":"plugin:code-review"}}]}}"#;
        let parsed = parse_claude_skill_line(line).unwrap();
        assert_eq!(parsed.id.as_deref(), Some("msg_1"));
        assert_eq!(parsed.skills, vec!["plugin:code-review"]);
    }

    #[test]
    fn parses_user_command_tag() {
        let line = r#"{"type":"user","timestamp":"2026-07-02T10:00:00Z","uuid":"u1","message":{"content":"<command-name>/translate</command-name>hello"}}"#;
        let parsed = parse_claude_skill_line(line).unwrap();
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
        assert_eq!(
            usage
                .week
                .daily_breakdown
                .iter()
                .map(|d| d.count)
                .sum::<u64>(),
            usage.week.total_calls,
            "daily_breakdown sum must equal total_calls"
        );
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
        let usage = discover_claude_usage_from_home(temp.path(), whitelist, 1, now);
        assert_eq!(usage.total_calls, 1);
        assert_eq!(usage.installed_skill_count, 1);
        assert_eq!(usage.recent[0].name, "code-review");
    }

    #[test]
    fn parses_codex_skill_read() {
        // Codex activates a skill by reading its SKILL.md via exec_command.
        let args = serde_json::json!({
            "cmd": "sed -n '1,220p' /Users/demo/.agents/skills/coding-philosophy-cce/SKILL.md"
        });
        let line = serde_json::json!({
            "timestamp": "2026-07-02T10:00:00Z",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "exec_command",
                "call_id": "call_1",
                "arguments": args.to_string()
            }
        })
        .to_string();
        let parsed = parse_codex_skill_line(&line).unwrap();
        assert_eq!(parsed.skills, vec!["coding-philosophy-cce"]);
        assert_eq!(parsed.id, None);
    }

    #[test]
    fn codex_parser_ignores_non_skill_commands() {
        let patch = serde_json::json!({
            "timestamp": "2026-07-02T10:00:00Z",
            "type": "response_item",
            "payload": {"type": "custom_tool_call", "name": "apply_patch", "input": "..."}
        })
        .to_string();
        assert!(parse_codex_skill_line(&patch).is_none());

        let exec = serde_json::json!({
            "timestamp": "2026-07-02T10:00:00Z",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "exec_command",
                "arguments": serde_json::json!({"cmd": "ls -la"}).to_string()
            }
        })
        .to_string();
        assert!(parse_codex_skill_line(&exec).is_none());
    }

    #[test]
    fn discovers_codex_logs_with_whitelist_filtering() {
        let temp = tempfile::tempdir().unwrap();
        let session_dir = temp.path().join(".codex/sessions/2026/07/02");
        std::fs::create_dir_all(&session_dir).unwrap();
        let args = serde_json::json!({
            "cmd": "sed -n '1,200p' /Users/demo/.agents/skills/coding-philosophy-cce/SKILL.md"
        });
        let line = serde_json::json!({
            "timestamp": "2026-07-02T10:00:00Z",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "exec_command",
                "call_id": "call_1",
                "arguments": args.to_string()
            }
        })
        .to_string();
        std::fs::write(session_dir.join("rollout-demo.jsonl"), line).unwrap();
        let whitelist = HashSet::from(["coding-philosophy-cce".to_string()]);
        let now = Local.with_ymd_and_hms(2026, 7, 2, 12, 0, 0).unwrap();
        let usage = discover_codex_usage_from_home(temp.path(), whitelist, 1, now);
        assert_eq!(usage.total_calls, 1);
        assert_eq!(usage.installed_skill_count, 1);
        assert_eq!(usage.recent[0].name, "coding-philosophy-cce");
    }
}
