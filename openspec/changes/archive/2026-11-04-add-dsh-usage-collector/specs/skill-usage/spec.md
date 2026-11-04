# Spec Delta

## MODIFIED Requirements

### Requirement: Per-agent collection from local stores
The system SHALL collect skill-usage events for an agent only from that agent's designated local store — `~/.claude/projects` for Claude Code, `~/.codex/sessions` for Codex, `~/.zcode/cli/db/db.sqlite` for ZCode, and `~/.dsh/sessions` for DeepSeek Harness — and SHALL report zero usage for agents that have no collector.

#### Scenario: Each supported agent has a designated store
- **WHEN** usage is collected for Claude Code, Codex, ZCode, or DeepSeek Harness
- **THEN** events are read only from that agent's designated local store

#### Scenario: Agent without a collector
- **WHEN** usage is collected for an agent with no collector registered
- **THEN** the result reports zero usage and keeps the installed-skill count unchanged

### Requirement: Collection robustness
The system SHALL skip undecodable records and missing stores without failing collection: an invalid line in a session file MUST NOT drop surrounding valid events, a session file that fails to decompress MUST be skipped without failing collection, and a missing session directory or database SHALL yield empty usage rather than an error.

#### Scenario: Invalid line between valid lines
- **WHEN** a session file contains a non-JSON line between two valid skill-invocation lines
- **THEN** both valid events are still collected

#### Scenario: Compressed session file fails to decompress
- **WHEN** a compressed session file cannot be decompressed
- **THEN** that file is skipped and collection continues with the remaining files

#### Scenario: Store does not exist
- **WHEN** an agent's session directory or database is absent
- **THEN** collection returns empty usage for that agent without an error

## ADDED Requirements

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
