# skill-usage Specification

## Purpose

Collect per-agent skill-usage events from each AI coding agent's local conversation store so Usage Habits views (totals, weekly/monthly periods, recent skills) reflect what actually happened on disk.

## Requirements

### Requirement: Per-agent collection from local stores
The system SHALL collect skill-usage events for an agent only from that agent's designated local store — `~/.claude/projects` for Claude Code, `~/.codex/sessions` for Codex, `~/.zcode/cli/db/db.sqlite` for ZCode, and `~/.dsh/sessions` for DeepSeek Harness — and SHALL report zero usage for agents that have no collector.

#### Scenario: Each supported agent has a designated store
- **WHEN** usage is collected for Claude Code, Codex, ZCode, or DeepSeek Harness
- **THEN** events are read only from that agent's designated local store

#### Scenario: Agent without a collector
- **WHEN** usage is collected for an agent with no collector registered
- **THEN** the result reports zero usage and keeps the installed-skill count unchanged

### Requirement: Claude Code usage events
The system SHALL attribute Claude Code agent-initiated usage to assistant records whose content contains a Skill tool invocation naming the skill, and user-initiated usage to user records carrying a command-name tag, deduplicating records that share the same message identifier.

#### Scenario: Assistant invokes a skill
- **WHEN** an assistant record contains a Skill tool-use block naming `code-review`
- **THEN** one agent-initiated usage event for `code-review` is recorded

#### Scenario: User invokes a slash command
- **WHEN** a user record's text contains a command-name tag for `/translate`
- **THEN** one user-initiated usage event for `translate` is recorded

#### Scenario: Same message identifier appears twice
- **WHEN** two records share the same message identifier and name the same skill
- **THEN** only one usage event is counted

### Requirement: Codex agent-initiated usage from tool calls
The system SHALL attribute Codex agent-initiated usage to tool calls whose command text references a `skills/<name>/SKILL.md` file, accepting both legacy function-call records with JSON-encoded arguments and current command-execution custom tool calls whose input embeds the command.

#### Scenario: Current custom tool call reads a skill file
- **WHEN** a Codex record carries a command-execution custom tool call whose input embeds a command referencing `~/.codex/skills/diagnosing-bugs/SKILL.md`
- **THEN** one agent-initiated usage event for `diagnosing-bugs` is recorded

#### Scenario: Legacy function call reads a skill file
- **WHEN** a Codex record carries a legacy function call whose JSON arguments reference a `skills/<name>/SKILL.md` path
- **THEN** one agent-initiated usage event for that skill is recorded

#### Scenario: Patch call mentioning a skill file path is not usage
- **WHEN** a Codex record carries a patch-editing tool call whose content merely mentions a `SKILL.md` path
- **THEN** no usage event is recorded

### Requirement: Codex user-initiated usage from dollar-prefix messages
The system SHALL attribute Codex user-initiated usage to user messages starting with `$skill-name`, accepting both legacy message events and current user-role records, and SHALL count a message and its mirrored duplicate as one event.

#### Scenario: Current user message with dollar prefix
- **WHEN** a user-role record's text starts with `$github-research-assistant`
- **THEN** one user-initiated usage event for `github-research-assistant` is recorded

#### Scenario: Legacy user message event with dollar prefix
- **WHEN** a legacy message event carries a user message starting with `$code-review`
- **THEN** one user-initiated usage event for `code-review` is recorded

#### Scenario: Mirrored duplicate of the same message
- **WHEN** the same `$code-review` user message appears as both a legacy message event and a user-role record
- **THEN** only one usage event is counted

### Requirement: ZCode usage events
The system SHALL attribute ZCode agent-initiated usage to completed Skill tool parts, taking the skill name from the tool input and deduplicating parts that share the same call identifier, and SHALL attribute user-initiated usage to user-message text parts whose first line starts with `/skill-name` matching a whitelisted skill.

#### Scenario: Completed Skill tool part
- **WHEN** a ZCode part records a completed Skill tool call with input skill `openspec-update-change`
- **THEN** one agent-initiated usage event for `openspec-update-change` is recorded

#### Scenario: Duplicate call identifier
- **WHEN** two Skill tool parts share the same call identifier and skill
- **THEN** only one usage event is counted

#### Scenario: Incomplete tool part
- **WHEN** a Skill tool part has not completed
- **THEN** no usage event is recorded for it

#### Scenario: User slash command text
- **WHEN** a user-message text part's first line starts with `/code-review` and `code-review` is whitelisted
- **THEN** one user-initiated usage event for `code-review` is recorded

### Requirement: DeepSeek Harness usage events
The system SHALL attribute DeepSeek Harness usage to user-message records whose text starts with a `<skill_content name="…">` marker, taking the skill name from the marker, counting each injection as one event, and reading compressed session files transparently regardless of their stored format version. Skill-catalog listings, skill-content text merely mentioned in other records, and the tool-dispatch records that pair with an injection SHALL NOT be counted.

#### Scenario: Skill-content injection counts as usage
- **WHEN** a user-message record's text starts with `<skill_content name="worth-fix">`
- **THEN** one agent-initiated usage event for `worth-fix` is recorded

#### Scenario: Skill catalog listing is not usage
- **WHEN** a record only lists available skills in a skill catalog
- **THEN** no usage event is recorded

#### Scenario: Skill content mentioned in another record type
- **WHEN** an assistant record's text merely mentions a `<skill_content` marker
- **THEN** no usage event is recorded

#### Scenario: Paired tool dispatch is not double-counted
- **WHEN** a session contains both the tool-dispatch records and the skill-content injection of the same skill load
- **THEN** only the injection yields a usage event

#### Scenario: Older format versions are read
- **WHEN** session files exist under a different stored format version than the newest one
- **THEN** their skill-content injections are still counted

### Requirement: Whitelist attribution
The system SHALL count only usage whose normalized skill name matches the installed-skills whitelist, where normalization strips leading slashes, plugin prefixes, and path segments so an event counts toward its bare skill name.

#### Scenario: Plugin-prefixed skill name
- **WHEN** an event names `plugin:code-review` and `code-review` is whitelisted
- **THEN** the event counts for `code-review`

#### Scenario: Non-whitelisted skill name
- **WHEN** an event names a skill that is not installed
- **THEN** the event is ignored

### Requirement: Collection robustness
The system SHALL skip undecodable records and missing stores without failing collection: an invalid line in a session file MUST NOT drop surrounding valid events, a session file that fails to decompress MUST be skipped without failing collection, and a missing session directory or database SHALL yield empty usage rather than an error. Inaccessible stores and database connection or query failures SHALL be reported as errors instead of zero usage.

#### Scenario: Invalid line between valid lines
- **WHEN** a session file contains a non-JSON line between two valid skill-invocation lines
- **THEN** both valid events are still collected

#### Scenario: Compressed session file fails to decompress
- **WHEN** a compressed session file cannot be decompressed
- **THEN** that file is skipped and collection continues with the remaining files

#### Scenario: Store does not exist
- **WHEN** an agent's session directory or database is absent
- **THEN** collection returns empty usage for that agent without an error

#### Scenario: Store exists but cannot be read
- **WHEN** directory or file access fails, or the SQLite store cannot be opened or queried
- **THEN** collection reports a read error rather than successful empty usage

### Requirement: Codex format-drift sentinel
The system SHALL detect suspected format drift in Codex session files: when scanned files reference `SKILL.md` yet yield no attributed usage events, the system SHALL emit a warning log identifying the affected files; when events are attributed normally, no warning SHALL be emitted.

#### Scenario: References without attributed events
- **WHEN** scanned Codex session files mention `SKILL.md` and no usage event is attributed from them
- **THEN** a warning log lists the affected files

#### Scenario: Normal attribution
- **WHEN** skill-file references produce attributed usage events
- **THEN** no drift warning is emitted

### Requirement: Shared selected usage agent
Usage Habits and the tray's Recently Used menu SHALL use the same saved usage-agent setting, preferring Codex when the saved selection is unavailable, then the first available tracked agent. Selection changes SHALL become visible after successful persistence; failed saves SHALL retain the previous selection and show an error. A valid selected agent with empty or unreadable usage SHALL NOT fall back to another agent.

#### Scenario: Select ZCode
- **WHEN** the user selects ZCode and saving succeeds
- **THEN** the dialog and tray read ZCode, while the tray title remains Recently Used without an agent suffix

#### Scenario: Selection save fails
- **WHEN** saving a new selection fails
- **THEN** both consumers retain the prior selection and the dialog reports the failure

### Requirement: Shared per-agent usage snapshots
The dialog and tray SHALL share a per-agent usage cache with a 30-second freshness window and coalesce concurrent scans, including concurrent failed scans. Different agents SHALL scan independently. Refresh failure SHALL preserve only that agent's previous successful result with an error; a subsequent retry SHALL be possible. A late result SHALL NOT overwrite another selected agent's view.

#### Scenario: Dialog and tray refresh together
- **WHEN** both request stale data for the same agent concurrently
- **THEN** one scan supplies both requests

#### Scenario: Switch while an old scan runs
- **WHEN** ZCode is selected while another agent is being scanned
- **THEN** ZCode loads independently; the old scan updates only its own cache

#### Scenario: Refresh failure after success
- **WHEN** a refresh fails after that agent had a successful result
- **THEN** its prior result remains available with an error and retry can recover

### Requirement: Recent usage presentation and refresh
Recently Used SHALL distinguish initial loading, successful records, successful empty usage, and read failure, and SHALL use the plain Recently Used title without an agent suffix. Results SHALL remain time-ordered, deduplicated by skill, and limited to five. It SHALL offer retry after failure and retain same-agent old results during refresh.

#### Scenario: Fresh agent has no result yet
- **WHEN** switching to an agent with no cached result
- **THEN** loading is displayed without another agent's records

#### Scenario: Missing versus unreadable store
- **WHEN** the selected store is absent or unreadable
- **THEN** absence produces an empty state, while read failure produces an error and retry

### Requirement: Usage refresh checks
Supported tray events SHALL check freshness. A serial background check separated by 30 seconds after completion SHALL cover platforms without events. Usage Habits SHALL check while open. Refresh SHALL only scan the requested agent, reuse fresh cached results, and SHALL NOT promise realtime updates.

#### Scenario: No tray mouse event support
- **WHEN** the platform does not emit tray mouse events
- **THEN** the background freshness check keeps snapshots available for subsequent menu openings

### Requirement: Tray usage navigation
Recently Used SHALL offer View usage in loading, empty, success and failure states. It SHALL appear above the copy hint when records exist and open the existing Usage Habits dialog for the saved agent. Navigation SHALL respect unsaved-edit confirmation.

#### Scenario: Open usage from the tray
- **WHEN** the user clicks View usage
- **THEN** the main window opens the Usage Habits dialog, closing a clean detail view or requesting confirmation for unsaved edits first
