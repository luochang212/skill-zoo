use crate::persistence::SkillCache;
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, TimeZone, Weekday};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::BufRead;
use std::path::{Path, PathBuf};

const RECENT_LIMIT: usize = 5;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillUsageRank {
    pub name: String,
    pub count: u64,
    pub user_calls: u64,
    pub agent_calls: u64,
    pub last_used_at: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillUsageSourceCounts {
    pub user: u64,
    pub agent: u64,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillUsagePeriod {
    pub total_calls: u64,
    pub source_counts: SkillUsageSourceCounts,
    pub skills: Vec<SkillUsageRank>,
    pub daily_breakdown: Vec<DailyCount>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DailyCount {
    pub label: String,
    pub date: String,
    pub count: u64,
    pub user_calls: u64,
    pub agent_calls: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentSkillUsage {
    pub name: String,
    pub command: String,
    pub source: SkillUsageSource,
    pub last_used_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillUsage {
    pub installed_skill_count: usize,
    pub total_calls: u64,
    pub source_counts: SkillUsageSourceCounts,
    pub week: SkillUsagePeriod,
    pub month: SkillUsagePeriod,
    pub recent: Vec<RecentSkillUsage>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum SkillUsageSource {
    User,
    Agent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SkillUsageEvent {
    name: String,
    ts_ms: i64,
    source: SkillUsageSource,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedSkillLine {
    id: Option<String>,
    ts_ms: i64,
    source: SkillUsageSource,
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
) -> Result<SkillUsage, String> {
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
) -> Result<SkillUsage, String> {
    let (events, count) = USAGE_COLLECTORS
        .iter()
        .find(|c| c.agent_id == agent_id)
        .map(|c| (c.collect)(home, whitelist, installed_skill_count))
        .unwrap_or(Ok((Vec::new(), installed_skill_count)))?;
    Ok(build_usage(count, events, now))
}

// ---------------------------------------------------------------------------
// Registry: add a new agent by adding one entry here + one collector function.
// ---------------------------------------------------------------------------

type EventCollector = fn(
    home: &Path,
    whitelist: HashSet<String>,
    installed_skill_count: usize,
) -> Result<(Vec<SkillUsageEvent>, usize), String>;

struct UsageCollectorEntry {
    agent_id: &'static str,
    collect: EventCollector,
}

pub fn supports_agent(agent_id: &str) -> bool {
    USAGE_COLLECTORS
        .iter()
        .any(|collector| collector.agent_id == agent_id)
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
        agent_id: "zcode",
        collect: collect_zcode_events,
    },
    UsageCollectorEntry {
        agent_id: "dsh",
        collect: collect_dsh_events,
    },
];

// ---------------------------------------------------------------------------
// Per-agent event collectors
// ---------------------------------------------------------------------------

fn collect_claude_events(
    home: &Path,
    whitelist: HashSet<String>,
    installed_skill_count: usize,
) -> Result<(Vec<SkillUsageEvent>, usize), String> {
    let (whitelist, count) =
        effective_whitelist(home, "claude-code", whitelist, installed_skill_count);
    let mut files = Vec::new();
    collect_jsonl_files(&home.join(".claude").join("projects"), &mut files)?;
    let (events, _skill_file_mentions) =
        aggregate_events(&files, parse_claude_skill_line, &whitelist)?;
    Ok((events, count))
}

fn collect_codex_events(
    home: &Path,
    whitelist: HashSet<String>,
    installed_skill_count: usize,
) -> Result<(Vec<SkillUsageEvent>, usize), String> {
    let (whitelist, count) = effective_whitelist(home, "codex", whitelist, installed_skill_count);
    let mut files = Vec::new();
    collect_jsonl_files(&home.join(".codex").join("sessions"), &mut files)?;
    let (events, skill_file_mentions) =
        aggregate_events(&files, parse_codex_skill_line, &whitelist)?;
    report_codex_drift(&skill_file_mentions, &events);
    Ok((events, count))
}

/// Format-drift sentinel: session files that reference SKILL.md without
/// yielding a single attributed event mean the rollout format moved under us
/// again. Returns the files to report, or None when attribution is healthy.
fn codex_drift_warning(
    skill_file_mentions: &[PathBuf],
    events: &[SkillUsageEvent],
) -> Option<String> {
    if !events.is_empty() || skill_file_mentions.is_empty() {
        return None;
    }
    let mut names: Vec<String> = skill_file_mentions
        .iter()
        .take(3)
        .map(|path| path.display().to_string())
        .collect();
    if skill_file_mentions.len() > 3 {
        names.push(format!("and {} more", skill_file_mentions.len() - 3));
    }
    Some(names.join(", "))
}

/// The app has no logging subscriber today (no `log`/`tracing` dependency),
/// so stderr — visible in the dev console and test output — is the channel.
fn report_codex_drift(skill_file_mentions: &[PathBuf], events: &[SkillUsageEvent]) {
    if let Some(files) = codex_drift_warning(skill_file_mentions, events) {
        eprintln!(
            "[skill_usage] warning: Codex session files reference SKILL.md but no usage was attributed (format drift?): {files}"
        );
    }
}

fn collect_zcode_events(
    home: &Path,
    whitelist: HashSet<String>,
    installed_skill_count: usize,
) -> Result<(Vec<SkillUsageEvent>, usize), String> {
    let (whitelist, count) = effective_whitelist(home, "zcode", whitelist, installed_skill_count);
    let db_path = home.join(".zcode").join("cli").join("db").join("db.sqlite");
    let events = query_zcode_skill_events(&db_path, &whitelist)?;
    Ok((events, count))
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

/// Shared per-line aggregation: keep one event per (dedup id, normalized
/// skill name) that survives the whitelist. Returns whether the line mentions
/// SKILL.md at all, feeding the Codex drift sentinel.
fn absorb_line(
    line: &str,
    parse_line: &impl Fn(&str) -> Option<ParsedSkillLine>,
    whitelist: &HashSet<String>,
    seen: &mut HashSet<(String, String)>,
    events: &mut Vec<SkillUsageEvent>,
) -> bool {
    let mentions_skill_file = line.contains("SKILL.md");
    if let Some(parsed) = parse_line(line) {
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
                source: parsed.source,
            });
        }
    }
    mentions_skill_file
}

/// Walk the collected session files, parse each line, and keep one
/// `SkillUsageEvent` per (dedup id, normalized skill name) that survives the
/// whitelist. Agent-agnostic: the caller supplies the line parser. Also
/// reports which files mention SKILL.md at all, feeding the Codex drift
/// sentinel.
fn aggregate_events(
    files: &[PathBuf],
    parse_line: impl Fn(&str) -> Option<ParsedSkillLine>,
    whitelist: &HashSet<String>,
) -> Result<(Vec<SkillUsageEvent>, Vec<PathBuf>), String> {
    let mut events = Vec::new();
    let mut seen = HashSet::new();
    let mut skill_file_mentions = Vec::new();
    for path in files {
        // Stream each session log line by line rather than buffering the
        // whole file into a `String`. A heavy Claude Code user can have
        // multi-tens-of-MB JSONL logs; this bounds peak memory to one line
        // plus the accumulated events. `BufRead::lines` splits lines exactly
        // like `str::lines` (same CRLF / trailing-newline handling), so any
        // valid UTF-8 file yields identical results. A line that fails to
        // decode is skipped, which is strictly more robust than the old
        // `read_to_string`, which dropped the entire file on one bad byte.
        let file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err("Could not read usage sessions".into()),
        };
        let mut mentions_skill_file = false;
        for line in std::io::BufReader::new(file).lines() {
            let line = match line {
                Ok(line) => line,
                Err(e) if e.kind() == std::io::ErrorKind::InvalidData => continue,
                Err(_) => return Err("Could not read usage sessions".into()),
            };
            if absorb_line(&line, &parse_line, whitelist, &mut seen, &mut events) {
                mentions_skill_file = true;
            }
        }
        if mentions_skill_file {
            skill_file_mentions.push(path.clone());
        }
    }
    Ok((events, skill_file_mentions))
}

fn build_usage(
    installed_skill_count: usize,
    mut events: Vec<SkillUsageEvent>,
    now: DateTime<Local>,
) -> SkillUsage {
    events.sort_by_key(|b| std::cmp::Reverse(b.ts_ms));
    let total_calls = events.len() as u64;
    let source_counts = source_counts(&events);
    let week = period_report(&events, Period::Week, now);
    let month = period_report(&events, Period::Month, now);
    let recent = recent_skills(&events);

    SkillUsage {
        installed_skill_count,
        total_calls,
        source_counts,
        week,
        month,
        recent,
    }
}

fn source_counts(events: &[SkillUsageEvent]) -> SkillUsageSourceCounts {
    let mut counts = SkillUsageSourceCounts::default();
    for event in events {
        counts.add(event.source);
    }
    counts
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

    let mut counts: HashMap<String, SkillUsageRankCounts> = HashMap::new();
    let mut daily: HashMap<NaiveDate, SkillUsageSourceCounts> = HashMap::new();
    let mut total_calls = 0;
    let mut source_counts = SkillUsageSourceCounts::default();
    for event in events {
        let Some(ts) = Local.timestamp_millis_opt(event.ts_ms).single() else {
            continue;
        };
        let date = ts.date_naive();
        if date < start_date {
            continue;
        }
        total_calls += 1;
        source_counts.add(event.source);
        let entry = counts.entry(event.name.clone()).or_default();
        entry.count += 1;
        entry.source_counts.add(event.source);
        entry.last_used_at = entry.last_used_at.max(event.ts_ms);
        daily.entry(date).or_default().add(event.source);
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
                count: daily.get(&date).copied().unwrap_or_default().total(),
                user_calls: daily.get(&date).copied().unwrap_or_default().user,
                agent_calls: daily.get(&date).copied().unwrap_or_default().agent,
            }
        })
        .collect();

    SkillUsagePeriod {
        total_calls,
        source_counts,
        skills: ranked_counts(counts),
        daily_breakdown,
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct SkillUsageRankCounts {
    count: u64,
    source_counts: SkillUsageSourceCounts,
    last_used_at: i64,
}

impl SkillUsageSourceCounts {
    fn add(&mut self, source: SkillUsageSource) {
        match source {
            SkillUsageSource::User => self.user += 1,
            SkillUsageSource::Agent => self.agent += 1,
        }
    }

    fn total(self) -> u64 {
        self.user + self.agent
    }
}

fn ranked_counts(counts: HashMap<String, SkillUsageRankCounts>) -> Vec<SkillUsageRank> {
    let mut ranks: Vec<_> = counts
        .into_iter()
        .map(|(name, counts)| SkillUsageRank {
            name,
            count: counts.count,
            user_calls: counts.source_counts.user,
            agent_calls: counts.source_counts.agent,
            last_used_at: counts.last_used_at,
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
            source: event.source,
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
/// 1. AI-initiated: a tool call reading `skills/<name>/SKILL.md`, carried as
///    a legacy `function_call` or a current `custom_tool_call`.
/// 2. User-initiated: `$skill-name` prefix in user messages, carried as a
///    legacy `event_msg` or a current user-role `response_item`.
fn parse_codex_skill_line(line: &str) -> Option<ParsedSkillLine> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    match value.get("type")?.as_str()? {
        "response_item" => parse_codex_response_item(&value),
        "event_msg" => parse_codex_user_message(&value),
        _ => None,
    }
}

/// `response_item` records carry both tool calls and — since the rollout
/// format retired the mirrored `event_msg` user message — user messages.
fn parse_codex_response_item(value: &serde_json::Value) -> Option<ParsedSkillLine> {
    let payload = value.get("payload")?;
    match payload.get("type").and_then(|t| t.as_str())? {
        "function_call" => parse_codex_exec_command(value, payload),
        "custom_tool_call" => parse_codex_custom_tool_call(value, payload),
        "message" => parse_codex_user_role_message(value, payload),
        _ => None,
    }
}

fn parse_codex_exec_command(
    value: &serde_json::Value,
    payload: &serde_json::Value,
) -> Option<ParsedSkillLine> {
    if payload.get("name").and_then(|n| n.as_str()) != Some("exec_command") {
        return None;
    }
    // `arguments` is itself a JSON-encoded string:
    // {"cmd":"sed -n '1,Np' …/skills/<name>/SKILL.md", ...}
    let arguments_str = payload.get("arguments").and_then(|a| a.as_str())?;
    let args_value: serde_json::Value = serde_json::from_str(arguments_str).ok()?;
    let cmd = args_value.get("cmd").and_then(|c| c.as_str())?;
    let skills = extract_skill_names_from_cmd(cmd);
    if skills.is_empty() {
        return None;
    }
    let ts_ms = timestamp_ms(value)?;
    Some(ParsedSkillLine {
        id: None,
        ts_ms,
        source: SkillUsageSource::Agent,
        skills,
    })
}

/// Current rollouts carry shell usage as `custom_tool_call` records named
/// `exec`, whose `input` is a raw string embedding the command, for example
/// `text(await tools.exec_command({cmd:"cat …/skills/<name>/SKILL.md"}))`.
/// The name check keeps patch-style custom calls — which may legitimately
/// mention a SKILL.md path inside a diff — from counting as usage.
fn parse_codex_custom_tool_call(
    value: &serde_json::Value,
    payload: &serde_json::Value,
) -> Option<ParsedSkillLine> {
    if payload.get("name").and_then(|n| n.as_str()) != Some("exec") {
        return None;
    }
    let input = payload.get("input").and_then(|i| i.as_str())?;
    let skills = extract_skill_names_from_cmd(input);
    if skills.is_empty() {
        return None;
    }
    let ts_ms = timestamp_ms(value)?;
    Some(ParsedSkillLine {
        id: None,
        ts_ms,
        source: SkillUsageSource::Agent,
        skills,
    })
}

/// Current user messages: `response_item` records with `role: "user"` whose
/// content is a list of `{type: "input_text", text: …}` blocks.
fn parse_codex_user_role_message(
    value: &serde_json::Value,
    payload: &serde_json::Value,
) -> Option<ParsedSkillLine> {
    if payload.get("role").and_then(|r| r.as_str()) != Some("user") {
        return None;
    }
    let text = match payload.get("content") {
        Some(serde_json::Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|block| block.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n"),
        Some(serde_json::Value::String(text)) => text.clone(),
        _ => return None,
    };
    finish_codex_user_message(value, payload, &text)
}

/// Legacy user messages: `event_msg` records with a `user_message` payload.
/// Detect `$skill-name` prefix. Example:
/// `"$github-research-assistant 介绍一下当前路径下的仓库"`
fn parse_codex_user_message(value: &serde_json::Value) -> Option<ParsedSkillLine> {
    let payload = value.get("payload")?;
    if payload.get("type").and_then(|t| t.as_str()) != Some("user_message") {
        return None;
    }
    let text = payload.get("message").and_then(|m| m.as_str())?;
    finish_codex_user_message(value, payload, text)
}

/// Shared tail for both user-message carriers: the `$skill` extraction plus
/// the dedup id. Rollouts may deliver one user message through both carriers
/// (mirrored duplicates), and neither current shape carries a session id, so
/// the id falls back to a text fingerprint that collapses the mirror pair.
fn finish_codex_user_message(
    value: &serde_json::Value,
    payload: &serde_json::Value,
    text: &str,
) -> Option<ParsedSkillLine> {
    let name = extract_dollar_skill(text)?;
    let ts_ms = timestamp_ms(value)?;
    let id = value
        .get("session_id")
        .or_else(|| payload.get("session_id"))
        .and_then(|id| id.as_str())
        .map(str::to_string)
        .or_else(|| Some(text.chars().take(80).collect()));
    Some(ParsedSkillLine {
        id,
        ts_ms,
        source: SkillUsageSource::User,
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

static SKILL_FILE_RE: std::sync::LazyLock<regex::Regex> =
    std::sync::LazyLock::new(|| regex::Regex::new(r"(?i)skills/([^/]+)/SKILL\.md").unwrap());

/// Pull skill names out of command text like `…/skills/<name>/SKILL.md`,
/// regardless of prefix (absolute, relative, or `~`). One command may read
/// several skill files at once; each contributes its own event.
fn extract_skill_names_from_cmd(text: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut seen = HashSet::new();
    for capture in SKILL_FILE_RE.captures_iter(text) {
        let Some(m) = capture.get(1) else {
            continue;
        };
        if seen.insert(m.as_str().to_string()) {
            names.push(m.as_str().to_string());
        }
    }
    names
}

// ---------------------------------------------------------------------------
// ZCode collector. It queries SQLite directly. The database mirrors
// OpenCode's table family, but tool names are Claude-Code-style PascalCase.
// ---------------------------------------------------------------------------

fn query_zcode_skill_events(
    db_path: &Path,
    whitelist: &HashSet<String>,
) -> Result<Vec<SkillUsageEvent>, String> {
    // ZCode may be running and the db is WAL-mode, so open read-only: the
    // collector must never take write locks. Only an absent store means no usage.
    if !db_path
        .try_exists()
        .map_err(|_| "Could not read ZCode usage database")?
    {
        return Ok(Vec::new());
    }
    let conn = match rusqlite::Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) {
        Ok(c) => c,
        Err(_) => return Err("Could not read ZCode usage database".into()),
    };

    let mut events = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();

    // 1. Explicit `Skill` tool calls (AI-initiated).
    {
        let mut stmt = conn
            .prepare(
                "SELECT json_extract(data, '$.state.input.skill'),
                COALESCE(json_extract(data, '$.state.time.start'), time_created),
                json_extract(data, '$.callID')
         FROM part
         WHERE json_valid(data) AND json_extract(data, '$.tool') = 'Skill'
           AND json_extract(data, '$.state.status') = 'completed'",
            )
            .map_err(|_| "Could not query ZCode usage database")?;
        let rows = stmt
            .query_map([], |row| {
                let name: Option<String> = row.get(0)?;
                let ts_ms: Option<i64> = row.get(1)?;
                let call_id: Option<String> = row.get(2)?;
                Ok((name, ts_ms, call_id))
            })
            .map_err(|_| "Could not query ZCode usage database")?;
        {
            for row in rows {
                let row = match row {
                    Ok(row) => row,
                    Err(rusqlite::Error::InvalidColumnType(..)) => continue,
                    Err(_) => return Err("Could not query ZCode usage database".into()),
                };
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
                    source: SkillUsageSource::Agent,
                });
            }
        }
    }

    // 2. Slash-command skill invocations typed by the user (ZCode writes no
    //    command-name markers): user-message text parts starting with
    //    `/skill-name`.
    {
        let mut stmt = conn.prepare(
        "SELECT m.session_id,
                json_extract(p.data, '$.text'),
                COALESCE(json_extract(p.data, '$.time.end'), json_extract(p.data, '$.time.start'), p.time_created)
         FROM part p
         JOIN message m ON p.message_id = m.id
         WHERE json_valid(p.data) AND json_valid(m.data) AND json_extract(p.data, '$.type') = 'text'
           AND json_extract(m.data, '$.role') = 'user'
           AND json_extract(p.data, '$.text') LIKE '/%'",
    ).map_err(|_| "Could not query ZCode usage database")?;
        let rows = stmt
            .query_map([], |row| {
                let session_id: Option<String> = row.get(0)?;
                let text: Option<String> = row.get(1)?;
                let ts_ms: Option<i64> = row.get(2)?;
                Ok((session_id, text, ts_ms))
            })
            .map_err(|_| "Could not query ZCode usage database")?;
        {
            for row in rows {
                let row = match row {
                    Ok(row) => row,
                    Err(rusqlite::Error::InvalidColumnType(..)) => continue,
                    Err(_) => return Err("Could not query ZCode usage database".into()),
                };
                let (Some(session_id), Some(text), Some(ts_ms)) = row else {
                    continue;
                };
                let Some(name) = extract_slash_skill(&text) else {
                    continue;
                };
                let Some(normalized) = normalize_skill_name(&name) else {
                    continue;
                };
                if !whitelist.contains(&normalized) {
                    continue;
                }
                if !seen.insert((session_id, normalized.clone())) {
                    continue;
                }
                events.push(SkillUsageEvent {
                    name: normalized,
                    ts_ms,
                    source: SkillUsageSource::User,
                });
            }
        }
    }

    Ok(events)
}

/// Extract skill name from a `/skill-name …` first line in a user message.
fn extract_slash_skill(text: &str) -> Option<String> {
    let first_line = text.lines().next()?;
    let rest = first_line.strip_prefix('/')?;
    let name = rest
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>();
    if name.is_empty() {
        return None;
    }
    Some(name)
}

// ---------------------------------------------------------------------------
// DeepSeek Harness collector. Session logs are Zstandard-compressed JSONL;
// decompress per file and scan lines for the skill-content injection marker.
// ---------------------------------------------------------------------------

fn collect_dsh_events(
    home: &Path,
    whitelist: HashSet<String>,
    installed_skill_count: usize,
) -> Result<(Vec<SkillUsageEvent>, usize), String> {
    let (whitelist, count) = effective_whitelist(home, "dsh", whitelist, installed_skill_count);
    let mut files = Vec::new();
    collect_dsh_session_files(&home.join(".dsh").join("sessions"), &mut files)?;
    let mut events = Vec::new();
    let mut seen = HashSet::new();
    // Mirrors `aggregate_events`' file loop. The line-error policy differs on
    // purpose: decompressor errors are persistent, so this loop breaks the
    // file where `aggregate_events` continues (recoverable UTF-8 skips).
    for path in &files {
        let Some(reader) = open_session_reader(path)? else {
            continue;
        };
        for line in reader.lines() {
            // A stream error from a decompressor is persistent: retrying it
            // would loop forever, so stop this file on the first failure.
            let Ok(line) = line else {
                break;
            };
            absorb_line(
                &line,
                &parse_dsh_skill_line,
                &whitelist,
                &mut seen,
                &mut events,
            );
        }
    }
    Ok((events, count))
}

/// DeepSeek Harness stores one log per session under
/// `sessions/<project>/<session>/`, with the format version in the filename
/// (`session.v4.jsonl.zstd`) and two observed nesting layouts. The version
/// only matters to full-fidelity consumers: the line scan reads
/// self-describing records, so any `session*.jsonl` / `session*.jsonl.zstd`
/// is collected regardless of nesting.
fn collect_dsh_session_files(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("Could not read usage sessions".into()),
    };
    for entry in entries {
        let entry = entry.map_err(|_| "Could not read usage sessions")?;
        let path = entry.path();
        if path.is_dir() {
            collect_dsh_session_files(&path, files)?;
        } else if is_dsh_session_file(&path) {
            files.push(path);
        }
    }
    Ok(())
}

fn is_dsh_session_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    name.starts_with("session") && (name.ends_with(".jsonl") || name.ends_with(".jsonl.zstd"))
}

/// Open a session file as a line stream, decompressing Zstandard files on the
/// fly. Multiframe files (one frame per durable append batch) are read to the
/// end. Errors surface as per-line failures, so a corrupt file simply
/// contributes no lines.
fn open_session_reader(path: &Path) -> Result<Option<Box<dyn std::io::BufRead>>, String> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Could not read usage sessions".into()),
    };
    if path.extension().and_then(|ext| ext.to_str()) == Some("zstd") {
        let Ok(decoder) = zstd::stream::Decoder::new(file) else {
            return Ok(None);
        };
        Ok(Some(Box::new(std::io::BufReader::new(decoder))))
    } else {
        Ok(Some(Box::new(std::io::BufReader::new(file))))
    }
}

/// A skill load is recorded as a user message whose text starts with the
/// injected `<skill_content name="…">` block; the name is the skill. Skill
/// catalogs (`<available_skills>`), assistant prose, and the paired
/// `tool/ptc-dispatch` records do not match the marker or the record type and
/// are ignored, so each load counts exactly once.
fn parse_dsh_skill_line(line: &str) -> Option<ParsedSkillLine> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    if value.get("type")?.as_str()? != "user/message" {
        return None;
    }
    let ts_ms = value.get("time")?.as_i64()?;
    let text = value
        .get("data")?
        .get("content")?
        .as_array()?
        .iter()
        .filter_map(|block| block.get("text").and_then(|text| text.as_str()))
        .next()?;
    let rest = text.trim_start().strip_prefix("<skill_content name=\"")?;
    let end = rest.find('"')?;
    let name = &rest[..end];
    if name.is_empty() {
        return None;
    }
    Some(ParsedSkillLine {
        id: None,
        ts_ms,
        source: SkillUsageSource::Agent,
        skills: vec![name.to_string()],
    })
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
    Some(ParsedSkillLine {
        id,
        ts_ms,
        source: SkillUsageSource::Agent,
        skills,
    })
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
        source: SkillUsageSource::User,
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

fn collect_jsonl_files(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("Could not read usage sessions".into()),
    };
    for entry in entries {
        let entry = entry.map_err(|_| "Could not read usage sessions")?;
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, files)?;
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_usage, codex_drift_warning, discover_skill_usage_from_home, extract_dollar_skill,
        extract_slash_skill, normalize_skill_name, parse_claude_skill_line, parse_codex_skill_line,
        parse_dsh_skill_line, SkillUsageEvent, SkillUsageSource,
    };
    use chrono::{Local, TimeZone};
    use std::collections::HashSet;
    use std::path::PathBuf;

    #[test]
    fn parses_assistant_skill_tool_use() {
        let line = r#"{"type":"assistant","timestamp":"2026-07-02T10:00:00Z","message":{"id":"msg_1","content":[{"type":"tool_use","name":"Skill","input":{"skill":"plugin:code-review"}}]}}"#;
        let parsed = parse_claude_skill_line(line).unwrap();
        assert_eq!(parsed.id.as_deref(), Some("msg_1"));
        assert_eq!(parsed.source, SkillUsageSource::Agent);
        assert_eq!(parsed.skills, vec!["plugin:code-review"]);
    }

    #[test]
    fn parses_user_command_tag() {
        let line = r#"{"type":"user","timestamp":"2026-07-02T10:00:00Z","uuid":"u1","message":{"content":"<command-name>/translate</command-name>hello"}}"#;
        let parsed = parse_claude_skill_line(line).unwrap();
        assert_eq!(parsed.id.as_deref(), Some("u1"));
        assert_eq!(parsed.source, SkillUsageSource::User);
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
                source: SkillUsageSource::Agent,
            },
            SkillUsageEvent {
                name: "translate".to_string(),
                ts_ms: (now - chrono::Duration::hours(1)).timestamp_millis(),
                source: SkillUsageSource::User,
            },
            SkillUsageEvent {
                name: "code-review".to_string(),
                ts_ms: (now - chrono::Duration::days(1)).timestamp_millis(),
                source: SkillUsageSource::User,
            },
        ];
        let usage = build_usage(2, events, now);
        assert_eq!(usage.total_calls, 3);
        assert_eq!(usage.source_counts.user, 2);
        assert_eq!(usage.source_counts.agent, 1);
        assert_eq!(usage.week.total_calls, 3);
        assert_eq!(usage.week.source_counts.user, 2);
        assert_eq!(usage.week.source_counts.agent, 1);
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
        assert_eq!(usage.week.skills[0].user_calls, 1);
        assert_eq!(usage.week.skills[0].agent_calls, 1);
        assert_eq!(usage.recent[0].command, "code-review");
        assert_eq!(usage.recent[0].source, SkillUsageSource::Agent);
        assert_eq!(usage.recent[1].command, "translate");
        assert_eq!(usage.recent[1].source, SkillUsageSource::User);
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
        let usage =
            discover_skill_usage_from_home("claude-code", temp.path(), whitelist, 1, now).unwrap();
        assert_eq!(usage.total_calls, 1);
        assert_eq!(usage.source_counts.user, 1);
        assert_eq!(usage.source_counts.agent, 0);
        assert_eq!(usage.installed_skill_count, 1);
        assert_eq!(usage.recent[0].name, "code-review");
        assert_eq!(usage.recent[0].source, SkillUsageSource::User);
    }

    #[test]
    fn aggregate_keeps_valid_lines_around_garbage() {
        // A non-JSON line in the middle must not stop iteration: the valid
        // line after it must still be captured, and a trailing newline must
        // not produce a phantom event. Guards against a stop-at-first-error
        // or off-by-one regression in the line iterator.
        let temp = tempfile::tempdir().unwrap();
        let project_dir = temp.path().join(".claude/projects/demo");
        std::fs::create_dir_all(&project_dir).unwrap();
        let valid1 = r#"{"type":"user","timestamp":"2026-07-02T10:00:00Z","uuid":"u1","message":{"content":"<command-name>/code-review</command-name>x"}}"#;
        let valid2 = r#"{"type":"user","timestamp":"2026-07-02T11:00:00Z","uuid":"u2","message":{"content":"<command-name>/code-review</command-name>x"}}"#;
        std::fs::write(
            project_dir.join("session.jsonl"),
            format!("{valid1}\nthis is not json\n{valid2}\n"),
        )
        .unwrap();
        let whitelist = HashSet::from(["code-review".to_string()]);
        let now = Local.with_ymd_and_hms(2026, 7, 2, 12, 0, 0).unwrap();
        let usage =
            discover_skill_usage_from_home("claude-code", temp.path(), whitelist, 1, now).unwrap();
        assert_eq!(
            usage.total_calls, 2,
            "both valid lines must survive the garbage line between them"
        );
    }

    #[test]
    fn aggregate_skips_invalid_utf8_line() {
        // The one genuine behavior change vs the old read_to_string: a line
        // that is not valid UTF-8 is skipped instead of poisoning the whole
        // file. The valid line after it must still be captured.
        let temp = tempfile::tempdir().unwrap();
        let project_dir = temp.path().join(".claude/projects/demo");
        std::fs::create_dir_all(&project_dir).unwrap();
        let valid1 = r#"{"type":"user","timestamp":"2026-07-02T10:00:00Z","uuid":"u1","message":{"content":"<command-name>/code-review</command-name>x"}}"#;
        let valid2 = r#"{"type":"user","timestamp":"2026-07-02T11:00:00Z","uuid":"u2","message":{"content":"<command-name>/code-review</command-name>x"}}"#;
        let mut body = Vec::new();
        body.extend_from_slice(valid1.as_bytes());
        body.extend_from_slice(b"\n\xff\xfe\n");
        body.extend_from_slice(valid2.as_bytes());
        body.extend_from_slice(b"\n");
        std::fs::write(project_dir.join("session.jsonl"), body).unwrap();
        let whitelist = HashSet::from(["code-review".to_string()]);
        let now = Local.with_ymd_and_hms(2026, 7, 2, 12, 0, 0).unwrap();
        let usage =
            discover_skill_usage_from_home("claude-code", temp.path(), whitelist, 1, now).unwrap();
        assert_eq!(
            usage.total_calls, 2,
            "an invalid-utf8 line must not drop the surrounding valid events"
        );
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
        assert_eq!(parsed.source, SkillUsageSource::Agent);
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
        let usage =
            discover_skill_usage_from_home("codex", temp.path(), whitelist, 1, now).unwrap();
        assert_eq!(usage.total_calls, 1);
        assert_eq!(usage.source_counts.user, 0);
        assert_eq!(usage.source_counts.agent, 1);
        assert_eq!(usage.installed_skill_count, 1);
        assert_eq!(usage.recent[0].name, "coding-philosophy-cce");
        assert_eq!(usage.recent[0].source, SkillUsageSource::Agent);
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
        assert_eq!(parsed.source, SkillUsageSource::User);
    }

    #[test]
    fn parses_codex_custom_tool_call_skill_reads() {
        // Current rollouts carry shell usage as a custom tool call named
        // `exec` whose input embeds the command; one command may read
        // several skill files.
        let input = "text(ALL_TOOLS.filter(x=>/exec_command/.test(x.name)));\n\
                     text(await tools.exec_command({cmd:\"cat /Users/alex/.codex/skills/diagnosing-bugs/SKILL.md \
                     /Users/alex/.codex/skills/coding-philosophy-cce/SKILL.md\"}))";
        let line = serde_json::json!({
            "timestamp": "2026-11-04T03:52:29.204Z",
            "type": "response_item",
            "payload": {
                "type": "custom_tool_call",
                "name": "exec",
                "call_id": "call_00_31Rr",
                "input": input
            }
        })
        .to_string();
        let parsed = parse_codex_skill_line(&line).unwrap();
        assert_eq!(
            parsed.skills,
            vec!["diagnosing-bugs", "coding-philosophy-cce"]
        );
        assert_eq!(parsed.source, SkillUsageSource::Agent);
        assert_eq!(parsed.id, None);
    }

    #[test]
    fn codex_parser_ignores_patch_call_mentioning_skill_file() {
        // A patch-style custom call may legitimately mention a SKILL.md path
        // inside a diff; it is not usage.
        let patch = serde_json::json!({
            "timestamp": "2026-11-04T03:52:29.204Z",
            "type": "response_item",
            "payload": {
                "type": "custom_tool_call",
                "name": "apply_patch",
                "input": "*** Begin Patch\n*** Update File: /repo/skills/foo/SKILL.md\n+edited"
            }
        })
        .to_string();
        assert!(parse_codex_skill_line(&patch).is_none());
    }

    #[test]
    fn parses_codex_user_role_message_skill() {
        let line = serde_json::json!({
            "timestamp": "2026-11-04T03:52:23.824Z",
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "$github-research-assistant 介绍一下当前路径下的仓库"}
                ]
            }
        })
        .to_string();
        let parsed = parse_codex_skill_line(&line).unwrap();
        assert_eq!(parsed.skills, vec!["github-research-assistant"]);
        assert_eq!(parsed.source, SkillUsageSource::User);
    }

    #[test]
    fn codex_mirrored_user_message_counted_once() {
        // Current rollouts can deliver one user message through both carriers
        // (legacy event + user-role record); the text fingerprint collapses
        // the mirror pair.
        let temp = tempfile::tempdir().unwrap();
        let session_dir = temp.path().join(".codex/sessions/2026/11/04");
        std::fs::create_dir_all(&session_dir).unwrap();
        let legacy = serde_json::json!({
            "timestamp": "2026-11-04T03:52:23.824Z",
            "type": "event_msg",
            "payload": {"type": "user_message", "message": "$code-review 检查最近的提交"}
        });
        let mirror = serde_json::json!({
            "timestamp": "2026-11-04T03:52:23.848Z",
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "$code-review 检查最近的提交"}]
            }
        });
        std::fs::write(
            session_dir.join("rollout-mirror.jsonl"),
            format!("{}\n{}", legacy, mirror),
        )
        .unwrap();
        let whitelist = HashSet::from(["code-review".to_string()]);
        let now = Local.with_ymd_and_hms(2026, 11, 4, 12, 0, 0).unwrap();
        let usage =
            discover_skill_usage_from_home("codex", temp.path(), whitelist, 1, now).unwrap();
        assert_eq!(
            usage.total_calls, 1,
            "a user message mirrored across carriers must count once"
        );
        assert_eq!(usage.source_counts.user, 1);
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
        let usage =
            discover_skill_usage_from_home("codex", temp.path(), whitelist, 1, now).unwrap();
        assert_eq!(
            usage.total_calls, 2,
            "should detect both old and new mechanisms"
        );
        assert_eq!(usage.source_counts.user, 1);
        assert_eq!(usage.source_counts.agent, 1);
    }

    #[test]
    fn codex_drift_warning_fires_only_without_events() {
        let mentioned = vec![PathBuf::from("/tmp/rollout-a.jsonl")];
        assert!(codex_drift_warning(&mentioned, &[]).is_some());
        let events = [SkillUsageEvent {
            name: "code-review".to_string(),
            ts_ms: 0,
            source: SkillUsageSource::Agent,
        }];
        assert!(codex_drift_warning(&mentioned, &events).is_none());
        assert!(codex_drift_warning(&[], &[]).is_none());
    }

    #[test]
    fn discovers_codex_prose_mention_without_events() {
        // A file that mentions SKILL.md in prose but yields no attributable
        // event exercises the drift-sentinel wiring; the warning itself shows
        // on stderr under --nocapture.
        let temp = tempfile::tempdir().unwrap();
        let session_dir = temp.path().join(".codex/sessions/2026/11/04");
        std::fs::create_dir_all(&session_dir).unwrap();
        let prose = serde_json::json!({
            "timestamp": "2026-11-04T10:00:00Z",
            "type": "event_msg",
            "payload": {"type": "user_message", "message": "帮忙看一下 skills/demo/SKILL.md 的写法"}
        });
        std::fs::write(session_dir.join("rollout-prose.jsonl"), prose.to_string()).unwrap();
        let whitelist = HashSet::from(["demo".to_string()]);
        let now = Local.with_ymd_and_hms(2026, 11, 4, 12, 0, 0).unwrap();
        let usage =
            discover_skill_usage_from_home("codex", temp.path(), whitelist, 1, now).unwrap();
        assert_eq!(
            usage.total_calls, 0,
            "prose mention must not count as usage"
        );
    }

    #[test]
    fn unreadable_stores_are_errors_but_absent_stores_are_empty() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("broken.db");
        std::fs::write(&db, "not sqlite").unwrap();
        assert!(super::query_zcode_skill_events(&db, &HashSet::new()).is_err());
        let mut files = Vec::new();
        assert!(super::collect_jsonl_files(&db, &mut files).is_err());
        assert!(super::collect_jsonl_files(&dir.path().join("missing"), &mut files).is_ok());
        assert!(
            super::query_zcode_skill_events(&dir.path().join("missing.db"), &HashSet::new())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn zcode_extracts_skill_events_from_sqlite() {
        let temp = tempfile::tempdir().unwrap();
        let db_path = temp.path().join("test.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE part (id INTEGER PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, time_created INTEGER);
             CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER);
             INSERT INTO part (data, time_created) VALUES ('{\"type\":\"tool\",\"tool\":\"Skill\",\"callID\":\"call_1\",\"state\":{\"status\":\"completed\",\"input\":{\"skill\":\"code-audit\"},\"time\":{\"start\":1779562587114}}}', 1779562587000);
             INSERT INTO part (data, time_created) VALUES ('{\"type\":\"tool\",\"tool\":\"Skill\",\"callID\":\"call_2\",\"state\":{\"status\":\"completed\",\"input\":{\"skill\":\"code-reviewer\"},\"time\":{\"start\":1779563158835}}}', 1779563158000);",
        )
        .unwrap();

        let whitelist = HashSet::from(["code-audit".to_string(), "code-reviewer".to_string()]);
        let events = super::query_zcode_skill_events(&db_path, &whitelist).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].name, "code-audit");
        assert_eq!(events[0].ts_ms, 1779562587114);
        assert_eq!(events[0].source, SkillUsageSource::Agent);
    }

    #[test]
    fn zcode_falls_back_to_row_time_created() {
        let temp = tempfile::tempdir().unwrap();
        let db_path = temp.path().join("test.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE part (id INTEGER PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, time_created INTEGER);
             CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER);
             INSERT INTO part (data, time_created) VALUES ('{\"type\":\"tool\",\"tool\":\"Skill\",\"callID\":\"call_1\",\"state\":{\"status\":\"completed\",\"input\":{\"skill\":\"code-audit\"}}}', 1779562587114);",
        )
        .unwrap();

        let whitelist = HashSet::from(["code-audit".to_string()]);
        let events = super::query_zcode_skill_events(&db_path, &whitelist).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].ts_ms, 1779562587114);
    }

    #[test]
    fn zcode_deduplicates_by_call_id() {
        let temp = tempfile::tempdir().unwrap();
        let db_path = temp.path().join("test.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE part (id INTEGER PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, time_created INTEGER);
             CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER);
             INSERT INTO part (data) VALUES ('{\"type\":\"tool\",\"tool\":\"Skill\",\"callID\":\"call_1\",\"state\":{\"status\":\"completed\",\"input\":{\"skill\":\"code-audit\"},\"time\":{\"start\":1}}}');
             INSERT INTO part (data) VALUES ('{\"type\":\"tool\",\"tool\":\"Skill\",\"callID\":\"call_1\",\"state\":{\"status\":\"completed\",\"input\":{\"skill\":\"code-audit\"},\"time\":{\"start\":2}}}');",
        )
        .unwrap();

        let whitelist = HashSet::from(["code-audit".to_string()]);
        let events = super::query_zcode_skill_events(&db_path, &whitelist).unwrap();
        assert_eq!(events.len(), 1, "duplicate callID should be deduped");
    }

    #[test]
    fn zcode_filters_by_whitelist() {
        let temp = tempfile::tempdir().unwrap();
        let db_path = temp.path().join("test.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE part (id INTEGER PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, time_created INTEGER);
             CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER);
             INSERT INTO part (data) VALUES ('{\"type\":\"tool\",\"tool\":\"Skill\",\"callID\":\"call_1\",\"state\":{\"status\":\"completed\",\"input\":{\"skill\":\"code-audit\"},\"time\":{\"start\":1}}}');
             INSERT INTO part (data) VALUES ('{\"type\":\"tool\",\"tool\":\"Skill\",\"callID\":\"call_2\",\"state\":{\"status\":\"completed\",\"input\":{\"skill\":\"other-skill\"},\"time\":{\"start\":2}}}');",
        )
        .unwrap();

        let whitelist = HashSet::from(["code-audit".to_string()]);
        let events = super::query_zcode_skill_events(&db_path, &whitelist).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].name, "code-audit");
    }

    #[test]
    fn zcode_handles_missing_db() {
        let whitelist = HashSet::from(["code-audit".to_string()]);
        let events = super::query_zcode_skill_events(
            &std::path::PathBuf::from("/nonexistent/db.sqlite"),
            &whitelist,
        )
        .unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn zcode_records_user_slash_command() {
        let temp = tempfile::tempdir().unwrap();
        let db_path = temp.path().join("test.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE part (id INTEGER PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, time_created INTEGER);
             CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER);
             INSERT INTO message VALUES ('msg_u1', 'ses_a', '{\"role\":\"user\"}', 1000000);
             INSERT INTO part (id, message_id, session_id, data, time_created) VALUES (1, 'msg_u1', 'ses_a', '{\"type\":\"text\",\"text\":\"/code-review 检查最近的提交\"}', 1000000);",
        )
        .unwrap();

        let whitelist = HashSet::from(["code-review".to_string()]);
        let events = super::query_zcode_skill_events(&db_path, &whitelist).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].name, "code-review");
        assert_eq!(events[0].source, SkillUsageSource::User);
    }

    #[test]
    fn zcode_slash_commands_filter_by_whitelist() {
        let temp = tempfile::tempdir().unwrap();
        let db_path = temp.path().join("test.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE part (id INTEGER PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, time_created INTEGER);
             CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER);
             INSERT INTO message VALUES ('msg_u1', 'ses_a', '{\"role\":\"user\"}', 1000000);
             INSERT INTO message VALUES ('msg_u2', 'ses_a', '{\"role\":\"user\"}', 1000001);
             INSERT INTO part (id, message_id, session_id, data, time_created) VALUES (1, 'msg_u1', 'ses_a', '{\"type\":\"text\",\"text\":\"/code-review 检查\"}', 1000000);
             INSERT INTO part (id, message_id, session_id, data, time_created) VALUES (2, 'msg_u2', 'ses_a', '{\"type\":\"text\",\"text\":\"/nope 不存在的技能\"}', 1000001);",
        )
        .unwrap();

        let whitelist = HashSet::from(["code-review".to_string()]);
        let events = super::query_zcode_skill_events(&db_path, &whitelist).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].name, "code-review");
    }

    #[test]
    fn extract_slash_skill_from_first_line() {
        assert_eq!(
            extract_slash_skill("/code-review 检查提交"),
            Some("code-review".to_string())
        );
        assert_eq!(
            extract_slash_skill("/translate\n\n后续内容"),
            Some("translate".to_string())
        );
        assert_eq!(extract_slash_skill("no slash"), None);
        assert_eq!(extract_slash_skill("/"), None);
        // Only the first line counts.
        assert_eq!(extract_slash_skill("先说点别的\n/code-review"), None);
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
        )
        .unwrap();
        assert_eq!(usage.total_calls, 0);
        assert_eq!(usage.installed_skill_count, 3);
    }

    #[test]
    fn parses_dsh_skill_content_injection() {
        let line = r#"{"type":"user/message","seq":1391,"time":1793587682323,"data":{"content":[{"type":"text","text":"<skill_content name=\"worth-fix\">\n<skill_resources>\nBase directory for this skill: /Users/alex/.dsh/skills/worth-fix\n</skill_resources>"}]}}"#;
        let parsed = parse_dsh_skill_line(line).unwrap();
        assert_eq!(parsed.skills, vec!["worth-fix"]);
        assert_eq!(parsed.source, SkillUsageSource::Agent);
        assert_eq!(parsed.id, None);
        assert_eq!(parsed.ts_ms, 1793587682323);
    }

    #[test]
    fn dsh_parser_ignores_catalogs_mentions_and_dispatch() {
        let catalog = r#"{"type":"user/message","time":1793628658929,"data":{"content":[{"type":"text","text":"<system-reminder>\nA skill is a reusable set of task-specific instructions.\n\n<available_skills>\n- `worth-fix`: 评估要不要修\n</available_skills>"}]}}"#;
        assert!(parse_dsh_skill_line(catalog).is_none());

        let mention = r#"{"type":"assistant/message","time":1793628658930,"data":{"content":[{"type":"text","text":"我先看看 <skill_content name=\"worth-fix\"> 的内容"}]}}"#;
        assert!(parse_dsh_skill_line(mention).is_none());

        let dispatch = r#"{"type":"tool/ptc-dispatch","time":1793628658931,"data":{"name":"skill","arguments":{},"content":"<skill_content name=\"worth-fix\">"}}"#;
        assert!(parse_dsh_skill_line(dispatch).is_none());
    }

    #[test]
    fn discovers_dsh_logs_across_layouts_and_encodings() {
        let temp = tempfile::tempdir().unwrap();
        let injection = |name: &str, time: i64| {
            serde_json::json!({
                "type": "user/message",
                "time": time,
                "data": {"content": [{"type": "text", "text": format!("<skill_content name=\"{name}\">\nbody")}]}
            })
            .to_string()
                + "\n"
        };
        // Layout 1: file directly in the session dir, current version.
        let direct = temp.path().join(
            ".dsh/sessions/--tmp-proj--/11111111-1111-1111-1111-111111111111/session.v4.jsonl.zstd",
        );
        std::fs::create_dir_all(direct.parent().unwrap()).unwrap();
        std::fs::write(
            &direct,
            zstd::stream::encode_all(injection("worth-fix", 1).as_bytes(), 3).unwrap(),
        )
        .unwrap();
        // Layout 2: nested one level deeper, older version filename, and a
        // multiframe file (two independently compressed frames concatenated).
        let nested = temp.path().join(
            ".dsh/sessions/--tmp-proj--/22222222-2222-2222-2222-222222222222/session-22222222-2222-2222-2222-222222222222/session.v3.jsonl.zstd",
        );
        std::fs::create_dir_all(nested.parent().unwrap()).unwrap();
        let mut multiframe =
            zstd::stream::encode_all(injection("demo-a", 2).as_bytes(), 3).unwrap();
        multiframe.extend(zstd::stream::encode_all(injection("demo-b", 3).as_bytes(), 3).unwrap());
        std::fs::write(&nested, multiframe).unwrap();
        // Uncompressed fallback still parses.
        let plain = temp
            .path()
            .join(".dsh/sessions/--tmp-proj--/33333333-3333-3333-3333-333333333333/session.jsonl");
        std::fs::create_dir_all(plain.parent().unwrap()).unwrap();
        std::fs::write(&plain, injection("worth-fix", 4)).unwrap();
        // A corrupt compressed file must be skipped, not fatal.
        let corrupt = temp.path().join(
            ".dsh/sessions/--tmp-proj--/44444444-4444-4444-4444-444444444444/session.v4.jsonl.zstd",
        );
        std::fs::create_dir_all(corrupt.parent().unwrap()).unwrap();
        std::fs::write(&corrupt, b"not zstd").unwrap();

        let whitelist = HashSet::from([
            "worth-fix".to_string(),
            "demo-a".to_string(),
            "demo-b".to_string(),
        ]);
        let now = Local.with_ymd_and_hms(2026, 11, 4, 12, 0, 0).unwrap();
        let usage = discover_skill_usage_from_home("dsh", temp.path(), whitelist, 1, now).unwrap();
        assert_eq!(
            usage.total_calls, 4,
            "both layouts, multiframe and uncompressed files all count"
        );
        assert_eq!(usage.source_counts.agent, 4);
        assert_eq!(usage.recent[0].name, "worth-fix");
    }
}
