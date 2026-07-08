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

pub fn skill_whitelist(cache: &SkillCache, _agent_id: &str) -> (HashSet<String>, usize) {
    let mut whitelist = HashSet::new();
    let mut installed_skill_count = 0;
    for skill in cache.skills() {
        installed_skill_count += 1;
        insert_skill_alias(&mut whitelist, &skill.name);
        insert_skill_alias(&mut whitelist, &skill.directory);
        if let Some(yaml_name) = &skill.yaml_name {
            insert_skill_alias(&mut whitelist, yaml_name);
        }
    }
    if whitelist.is_empty() {
        if let Some(dir) = crate::config::get_agent_skills_dir(_agent_id) {
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
    let (events, count) = USAGE_COLLECTORS
        .iter()
        .find(|c| c.agent_id == agent_id)
        .map(|c| (c.collect)(home, whitelist, installed_skill_count))
        .unwrap_or((Vec::new(), installed_skill_count));
    build_usage(count, events, now)
}

// ---------------------------------------------------------------------------
// Registry: add a new agent by adding one entry here + one collector function.
// ---------------------------------------------------------------------------

type EventCollector = fn(
    home: &Path,
    whitelist: HashSet<String>,
    installed_skill_count: usize,
) -> (Vec<SkillUsageEvent>, usize);

struct UsageCollectorEntry {
    agent_id: &'static str,
    collect: EventCollector,
}

static USAGE_COLLECTORS: &[UsageCollectorEntry] = &[
    UsageCollectorEntry {
        agent_id: "claude-code",
        collect: collect_claude_events,
    },
    UsageCollectorEntry {
        agent_id: "codex",
        collect: collect_codex_events,
    },
    UsageCollectorEntry {
        agent_id: "opencode",
        collect: collect_opencode_events,
    },
];

// ---------------------------------------------------------------------------
// Per-agent event collectors
// ---------------------------------------------------------------------------

fn collect_claude_events(
    home: &Path,
    whitelist: HashSet<String>,
    installed_skill_count: usize,
) -> (Vec<SkillUsageEvent>, usize) {
    let (whitelist, count) =
        effective_whitelist(home, "claude-code", whitelist, installed_skill_count);
    let mut files = Vec::new();
    collect_jsonl_files(&home.join(".claude").join("projects"), &mut files);
    let events = aggregate_events(&files, parse_claude_skill_line, &whitelist);
    (events, count)
}

fn collect_codex_events(
    home: &Path,
    whitelist: HashSet<String>,
    installed_skill_count: usize,
) -> (Vec<SkillUsageEvent>, usize) {
    let (whitelist, count) = effective_whitelist(home, "codex", whitelist, installed_skill_count);
    let mut files = Vec::new();
    collect_jsonl_files(&home.join(".codex").join("sessions"), &mut files);
    let events = aggregate_events(&files, parse_codex_skill_line, &whitelist);
    (events, count)
}

fn collect_opencode_events(
    home: &Path,
    whitelist: HashSet<String>,
    installed_skill_count: usize,
) -> (Vec<SkillUsageEvent>, usize) {
    let (whitelist, count) =
        effective_whitelist(home, "opencode", whitelist, installed_skill_count);
    let db_path = home
        .join(".local")
        .join("share")
        .join("opencode")
        .join("opencode.db");
    let events = query_opencode_skill_events(&db_path, &whitelist);
    (events, count)
}

/// When the in-memory cache yielded no whitelist, fall back to scanning the
/// agent's installed-skills directory on disk so usage still resolves.
fn effective_whitelist(
    _home: &Path,
    _agent_id: &str,
    whitelist: HashSet<String>,
    installed_skill_count: usize,
) -> (HashSet<String>, usize) {
    if !whitelist.is_empty() {
        return (whitelist, installed_skill_count);
    }
    let mut effective = HashSet::new();
    let dir = crate::config::get_agents_skills_dir();
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

/// Codex records skill usage in two ways:
/// 1. AI-initiated: `exec_command` reading `skills/<name>/SKILL.md` (legacy).
/// 2. User-initiated: `$skill-name` prefix in user messages.
fn parse_codex_skill_line(line: &str) -> Option<ParsedSkillLine> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    match value.get("type")?.as_str()? {
        "response_item" => parse_codex_exec_command(&value),
        "event_msg" => parse_codex_user_message(&value),
        _ => None,
    }
}

fn parse_codex_exec_command(value: &serde_json::Value) -> Option<ParsedSkillLine> {
    let payload = value.get("payload")?;
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
    let ts_ms = timestamp_ms(value)?;
    Some(ParsedSkillLine {
        id: None,
        ts_ms,
        skills: vec![name],
    })
}

/// Detect `$skill-name` prefix in user messages.
/// Example: `"$github-research-assistant 介绍一下当前路径下的仓库"`
fn parse_codex_user_message(value: &serde_json::Value) -> Option<ParsedSkillLine> {
    let payload = value.get("payload")?;
    if payload.get("type").and_then(|t| t.as_str()) != Some("user_message") {
        return None;
    }
    let text = payload.get("message").and_then(|m| m.as_str())?;
    let name = extract_dollar_skill(text)?;
    let ts_ms = timestamp_ms(value)?;
    let id = value
        .get("session_id")
        .or_else(|| payload.get("session_id"))
        .and_then(|id| id.as_str())
        .map(str::to_string);
    Some(ParsedSkillLine {
        id,
        ts_ms,
        skills: vec![name],
    })
}

/// Extract skill name from `$skill-name ...` prefix in a user message.
fn extract_dollar_skill(text: &str) -> Option<String> {
    let rest = text.strip_prefix('$')?;
    let name = rest
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '-')
        .collect::<String>();
    if name.is_empty() {
        return None;
    }
    Some(name)
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

// ---------------------------------------------------------------------------
// OpenCode collector — queries SQLite directly
// ---------------------------------------------------------------------------

fn query_opencode_skill_events(
    db_path: &Path,
    whitelist: &HashSet<String>,
) -> Vec<SkillUsageEvent> {
    let conn = match rusqlite::Connection::open(db_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut events = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();

    // 1. Explicit `skill` tool calls (AI-initiated).
    if let Ok(mut stmt) = conn.prepare(
        "SELECT json_extract(data, '$.state.input.name'),
                json_extract(data, '$.state.time.start'),
                json_extract(data, '$.callID')
         FROM part
         WHERE json_extract(data, '$.tool') = 'skill'
           AND json_extract(data, '$.state.status') = 'completed'",
    ) {
        let rows = stmt.query_map([], |row| {
            let name: Option<String> = row.get(0)?;
            let ts_ms: Option<i64> = row.get(1)?;
            let call_id: Option<String> = row.get(2)?;
            Ok((name, ts_ms, call_id))
        });
        if let Ok(rows) = rows {
            for row in rows.flatten() {
                let (Some(name), Some(ts_ms), call_id) = row else {
                    continue;
                };
                let Some(normalized) = normalize_skill_name(&name) else {
                    continue;
                };
                if !whitelist.contains(&normalized) {
                    continue;
                }
                if let Some(ref call_id) = call_id {
                    if !seen.insert((call_id.clone(), normalized.clone())) {
                        continue;
                    }
                }
                events.push(SkillUsageEvent {
                    name: normalized,
                    ts_ms,
                });
            }
        }
    }

    // 2. Slash-command skill injections: SKILL.md content injected as
    //    a text part in a user message (starts with "# <skill title>").
    if let Ok(mut stmt) = conn.prepare(
        "SELECT m.session_id,
                json_extract(p.data, '$.text'),
                p.time_created
         FROM part p
         JOIN message m ON p.message_id = m.id
         WHERE json_extract(p.data, '$.type') = 'text'
           AND json_extract(m.data, '$.role') = 'user'
           AND json_extract(p.data, '$.text') LIKE '# %'",
    ) {
        let rows = stmt.query_map([], |row| {
            let session_id: Option<String> = row.get(0)?;
            let text: Option<String> = row.get(1)?;
            let ts_ms: Option<i64> = row.get(2)?;
            Ok((session_id, text, ts_ms))
        });
        if let Ok(rows) = rows {
            for row in rows.flatten() {
                let (Some(session_id), Some(text), Some(ts_ms)) = row else {
                    continue;
                };
                let Some(heading) = extract_heading(&text) else {
                    continue;
                };
                let Some(name) = match_heading_to_whitelist(&heading, whitelist) else {
                    continue;
                };
                if !seen.insert((session_id, name.clone())) {
                    continue;
                }
                events.push(SkillUsageEvent { name, ts_ms });
            }
        }
    }

    events
}

/// Extract the first `# <title>` heading line from SKILL.md content.
fn extract_heading(text: &str) -> Option<String> {
    let line = text.lines().next()?;
    let stripped = line.strip_prefix("# ")?.trim();
    if stripped.is_empty() {
        return None;
    }
    Some(stripped.to_string())
}

/// Try to match a heading (e.g. "GitHub Research Assistant") to a whitelist
/// entry (e.g. "github-research-assistant"). Uses kebab-case normalisation.
fn match_heading_to_whitelist(heading: &str, whitelist: &HashSet<String>) -> Option<String> {
    let kebab = heading_to_kebab(heading);
    if whitelist.contains(&kebab) {
        return Some(kebab);
    }
    // Also try without conversion — the heading might already be kebab-case
    // (e.g. "code-audit" matches directory name exactly).
    if whitelist.contains(heading) {
        return Some(heading.to_string());
    }
    None
}

fn heading_to_kebab(heading: &str) -> String {
    heading
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
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
        build_usage, discover_skill_usage_from_home, extract_dollar_skill, extract_heading,
        heading_to_kebab, match_heading_to_whitelist, normalize_skill_name,
        parse_claude_skill_line, parse_codex_skill_line, SkillUsageEvent,
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
        let usage = discover_skill_usage_from_home("claude-code", temp.path(), whitelist, 1, now);
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
        let usage = discover_skill_usage_from_home("codex", temp.path(), whitelist, 1, now);
        assert_eq!(usage.total_calls, 1);
        assert_eq!(usage.installed_skill_count, 1);
        assert_eq!(usage.recent[0].name, "coding-philosophy-cce");
    }

    #[test]
    fn extract_dollar_skill_from_user_message() {
        assert_eq!(
            extract_dollar_skill("$github-research-assistant 介绍一下"),
            Some("github-research-assistant".to_string())
        );
        assert_eq!(
            extract_dollar_skill("$code-review"),
            Some("code-review".to_string())
        );
        assert_eq!(extract_dollar_skill("no prefix"), None);
        assert_eq!(extract_dollar_skill("$"), None);
    }

    #[test]
    fn parses_codex_user_message_skill() {
        let line = serde_json::json!({
            "timestamp": "2026-07-08T01:21:38Z",
            "type": "event_msg",
            "payload": {
                "type": "user_message",
                "message": "$github-research-assistant 介绍一下当前路径下的仓库"
            }
        })
        .to_string();
        let parsed = parse_codex_skill_line(&line).unwrap();
        assert_eq!(parsed.skills, vec!["github-research-assistant"]);
    }

    #[test]
    fn discovers_codex_dollar_skill_with_whitelist() {
        let temp = tempfile::tempdir().unwrap();
        let session_dir = temp.path().join(".codex/sessions/2026/07/08");
        std::fs::create_dir_all(&session_dir).unwrap();
        // Mix: old-style exec_command + new-style $skill-name
        let args = serde_json::json!({
            "cmd": "sed -n '1,200p' /Users/demo/.agents/skills/coding-philosophy-cce/SKILL.md"
        });
        let old_line = serde_json::json!({
            "timestamp": "2026-07-08T10:00:00Z",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "exec_command",
                "call_id": "call_1",
                "arguments": args.to_string()
            }
        });
        let new_line = serde_json::json!({
            "timestamp": "2026-07-08T10:01:00Z",
            "type": "event_msg",
            "payload": {
                "type": "user_message",
                "message": "$github-research-assistant 分析一下仓库"
            }
        });
        std::fs::write(
            session_dir.join("session.jsonl"),
            format!("{}\n{}", old_line, new_line),
        )
        .unwrap();
        let whitelist: HashSet<String> = ["coding-philosophy-cce", "github-research-assistant"]
            .into_iter()
            .map(String::from)
            .collect();
        let now = Local.with_ymd_and_hms(2026, 7, 8, 12, 0, 0).unwrap();
        let usage = discover_skill_usage_from_home("codex", temp.path(), whitelist, 1, now);
        assert_eq!(
            usage.total_calls, 2,
            "should detect both old and new mechanisms"
        );
    }

    #[test]
    fn opencode_extracts_skill_events_from_sqlite() {
        let temp = tempfile::tempdir().unwrap();
        let db_path = temp.path().join("test.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE part (data TEXT);
             INSERT INTO part VALUES ('{\"type\":\"tool\",\"tool\":\"skill\",\"callID\":\"call_1\",\"state\":{\"status\":\"completed\",\"input\":{\"name\":\"code-audit\"},\"time\":{\"start\":1779562587114}}}');
             INSERT INTO part VALUES ('{\"type\":\"tool\",\"tool\":\"skill\",\"callID\":\"call_2\",\"state\":{\"status\":\"completed\",\"input\":{\"name\":\"code-reviewer\"},\"time\":{\"start\":1779563158835}}}');",
        )
        .unwrap();

        let whitelist = HashSet::from(["code-audit".to_string(), "code-reviewer".to_string()]);
        let events = super::query_opencode_skill_events(&db_path, &whitelist);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].name, "code-audit");
        assert_eq!(events[0].ts_ms, 1779562587114);
    }

    #[test]
    fn opencode_deduplicates_by_call_id() {
        let temp = tempfile::tempdir().unwrap();
        let db_path = temp.path().join("test.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE part (data TEXT);
             INSERT INTO part VALUES ('{\"type\":\"tool\",\"tool\":\"skill\",\"callID\":\"call_1\",\"state\":{\"status\":\"completed\",\"input\":{\"name\":\"code-audit\"},\"time\":{\"start\":1}}}');
             INSERT INTO part VALUES ('{\"type\":\"tool\",\"tool\":\"skill\",\"callID\":\"call_1\",\"state\":{\"status\":\"completed\",\"input\":{\"name\":\"code-audit\"},\"time\":{\"start\":2}}}');",
        )
        .unwrap();

        let whitelist = HashSet::from(["code-audit".to_string()]);
        let events = super::query_opencode_skill_events(&db_path, &whitelist);
        assert_eq!(events.len(), 1, "duplicate callID should be deduped");
    }

    #[test]
    fn opencode_filters_by_whitelist() {
        let temp = tempfile::tempdir().unwrap();
        let db_path = temp.path().join("test.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE part (data TEXT);
             INSERT INTO part VALUES ('{\"type\":\"tool\",\"tool\":\"skill\",\"callID\":\"call_1\",\"state\":{\"status\":\"completed\",\"input\":{\"name\":\"code-audit\"},\"time\":{\"start\":1}}}');
             INSERT INTO part VALUES ('{\"type\":\"tool\",\"tool\":\"skill\",\"callID\":\"call_2\",\"state\":{\"status\":\"completed\",\"input\":{\"name\":\"other-skill\"},\"time\":{\"start\":2}}}');",
        )
        .unwrap();

        let whitelist = HashSet::from(["code-audit".to_string()]);
        let events = super::query_opencode_skill_events(&db_path, &whitelist);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].name, "code-audit");
    }

    #[test]
    fn opencode_handles_missing_db() {
        let whitelist = HashSet::from(["code-audit".to_string()]);
        let events = super::query_opencode_skill_events(
            &std::path::PathBuf::from("/nonexistent/db.sqlite"),
            &whitelist,
        );
        assert!(events.is_empty());
    }

    #[test]
    fn registry_unknown_agent_returns_empty() {
        let temp = tempfile::tempdir().unwrap();
        let now = chrono::Local::now();
        let usage = discover_skill_usage_from_home(
            "nonexistent-agent",
            temp.path(),
            HashSet::new(),
            3,
            now,
        );
        assert_eq!(usage.total_calls, 0);
        assert_eq!(usage.installed_skill_count, 3);
    }

    #[test]
    fn extract_heading_from_skill_md_text() {
        assert_eq!(
            extract_heading("# GitHub Research Assistant\n\nYou are a professional..."),
            Some("GitHub Research Assistant".to_string())
        );
        assert_eq!(extract_heading("plain text"), None);
        assert_eq!(extract_heading("# "), None);
    }

    #[test]
    fn heading_to_kebab_normalizes_titles() {
        assert_eq!(
            heading_to_kebab("GitHub Research Assistant"),
            "github-research-assistant"
        );
        assert_eq!(heading_to_kebab("code-audit"), "code-audit");
        assert_eq!(
            heading_to_kebab("Coding Philosophy  (CCE)"),
            "coding-philosophy-cce"
        );
    }

    #[test]
    fn match_heading_finds_whitelist_entry() {
        let whitelist: HashSet<String> = ["github-research-assistant", "code-audit"]
            .into_iter()
            .map(String::from)
            .collect();
        assert_eq!(
            match_heading_to_whitelist("GitHub Research Assistant", &whitelist),
            Some("github-research-assistant".to_string())
        );
        assert_eq!(
            match_heading_to_whitelist("code-audit", &whitelist),
            Some("code-audit".to_string())
        );
        assert_eq!(
            match_heading_to_whitelist("Unknown Skill", &whitelist),
            None
        );
    }

    #[test]
    fn opencode_detects_injected_skill_from_text_part() {
        let temp = tempfile::tempdir().unwrap();
        let db_path = temp.path().join("test.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        // Simulate a session with an injected SKILL.md in the user message
        // plus an explicit skill tool call for a different skill.
        conn.execute_batch(
            "CREATE TABLE part (
                id INTEGER PRIMARY KEY,
                message_id TEXT,
                session_id TEXT,
                data TEXT,
                time_created INTEGER
             );
             CREATE TABLE message (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                data TEXT,
                time_created INTEGER
             );
             CREATE TABLE session (id TEXT PRIMARY KEY);
             INSERT INTO session VALUES ('ses_a');
             INSERT INTO message VALUES ('msg_u1', 'ses_a', '{\"role\":\"user\"}', 1000000);
             INSERT INTO message VALUES ('msg_a1', 'ses_a', '{\"role\":\"assistant\"}', 2000000);
             -- Injected SKILL.md content in user message
             INSERT INTO part VALUES (1, 'msg_u1', 'ses_a', '{\"type\":\"text\",\"text\":\"# GitHub Research Assistant\\n\\nYou are a professional GitHub research assistant...\"}', 1000000);
             -- Explicit skill tool call for code-audit
             INSERT INTO part VALUES (2, 'msg_a1', 'ses_a', '{\"type\":\"tool\",\"tool\":\"skill\",\"callID\":\"call_1\",\"state\":{\"status\":\"completed\",\"input\":{\"name\":\"code-audit\"},\"time\":{\"start\":2000000}}}', 2000000);",
        )
        .unwrap();

        let whitelist: HashSet<String> = ["github-research-assistant", "code-audit"]
            .into_iter()
            .map(String::from)
            .collect();
        let events = super::query_opencode_skill_events(&db_path, &whitelist);
        assert_eq!(events.len(), 2);
        let names: Vec<&str> = events.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"github-research-assistant"));
        assert!(names.contains(&"code-audit"));
    }

    #[test]
    fn opencode_injected_skill_dedup_with_tool_call() {
        let temp = tempfile::tempdir().unwrap();
        let db_path = temp.path().join("test.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        // Same skill appears as both injected text AND explicit tool call —
        // should be deduplicated.
        conn.execute_batch(
            "CREATE TABLE part (
                id INTEGER PRIMARY KEY,
                message_id TEXT,
                session_id TEXT,
                data TEXT,
                time_created INTEGER
             );
             CREATE TABLE message (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                data TEXT,
                time_created INTEGER
             );
             CREATE TABLE session (id TEXT PRIMARY KEY);
             INSERT INTO session VALUES ('ses_a');
             INSERT INTO message VALUES ('msg_u1', 'ses_a', '{\"role\":\"user\"}', 1000000);
             INSERT INTO message VALUES ('msg_a1', 'ses_a', '{\"role\":\"assistant\"}', 2000000);
             INSERT INTO part VALUES (1, 'msg_u1', 'ses_a', '{\"type\":\"text\",\"text\":\"# GitHub Research Assistant\\n\\nYou are a professional...\"}', 1000000);
             INSERT INTO part VALUES (2, 'msg_a1', 'ses_a', '{\"type\":\"tool\",\"tool\":\"skill\",\"callID\":\"call_1\",\"state\":{\"status\":\"completed\",\"input\":{\"name\":\"GitHub Research Assistant\"},\"time\":{\"start\":2000000}}}', 2000000);",
        )
        .unwrap();

        let whitelist: HashSet<String> = ["github-research-assistant"]
            .into_iter()
            .map(String::from)
            .collect();
        let events = super::query_opencode_skill_events(&db_path, &whitelist);
        assert_eq!(
            events.len(),
            1,
            "same skill in same session should be deduped"
        );
    }
}
