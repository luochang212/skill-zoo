# skill-usage Specification

## Purpose

Collect per-agent skill-usage events from each AI coding agent's local conversation store so Usage Habits views (totals, weekly/monthly periods, recent skills) reflect what actually happened on disk.

## Requirements

### Requirement: Per-agent collection from local stores
The system SHALL collect skill-usage events for an agent only from that agent's designated local store — `~/.claude/projects` for Claude Code, `~/.codex/sessions` for Codex, and `~/.zcode/cli/db/db.sqlite` for ZCode — and SHALL report zero usage for agents that have no collector.

#### Scenario: Each supported agent has a designated store
- **WHEN** usage is collected for Claude Code, Codex, or ZCode
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

### Requirement: Whitelist attribution
The system SHALL count only usage whose normalized skill name matches the installed-skills whitelist, where normalization strips leading slashes, plugin prefixes, and path segments so an event counts toward its bare skill name.

#### Scenario: Plugin-prefixed skill name
- **WHEN** an event names `plugin:code-review` and `code-review` is whitelisted
- **THEN** the event counts for `code-review`

#### Scenario: Non-whitelisted skill name
- **WHEN** an event names a skill that is not installed
- **THEN** the event is ignored

### Requirement: Collection robustness
The system SHALL skip undecodable records and missing stores without failing collection: an invalid line in a session file MUST NOT drop surrounding valid events, and a missing session directory or database SHALL yield empty usage rather than an error.

#### Scenario: Invalid line between valid lines
- **WHEN** a session file contains a non-JSON line between two valid skill-invocation lines
- **THEN** both valid events are still collected

#### Scenario: Store does not exist
- **WHEN** an agent's session directory or database is absent
- **THEN** collection returns empty usage for that agent without an error

### Requirement: Codex format-drift sentinel
The system SHALL detect suspected format drift in Codex session files: when scanned files reference `SKILL.md` yet yield no attributed usage events, the system SHALL emit a warning log identifying the affected files; when events are attributed normally, no warning SHALL be emitted.

#### Scenario: References without attributed events
- **WHEN** scanned Codex session files mention `SKILL.md` and no usage event is attributed from them
- **THEN** a warning log lists the affected files

#### Scenario: Normal attribution
- **WHEN** skill-file references produce attributed usage events
- **THEN** no drift warning is emitted
