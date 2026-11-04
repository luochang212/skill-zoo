# Proposal

## Why

Usage Habits collection has silently drifted from reality. Verified against local data (2026-11-04): Codex moved skill reads from `function_call`/`exec_command` to `custom_tool_call`/`exec` and dropped `event_msg`/`user_message` in favor of `response_item` messages, so both Codex detection paths now match nothing and Codex usage statistics are silently zero. The OpenCode collector reads a database this user no longer produces (dormant since August, zero skill events), while ZCode — the daily driver — stores Skill invocations in an OpenCode-shaped SQLite database that no collector reads. Unit tests stay green because their fixtures still encode the old formats.

## What Changes

- **Codex collector**: parse the current rollout formats — `custom_tool_call` named `exec` whose input embeds `tools.exec_command({cmd:"…/skills/<name>/SKILL.md"})`, and user messages carried as `response_item` records with `role: "user"` content blocks (scanning for the `$skill-name` prefix). Legacy formats (`function_call`/`exec_command`, `event_msg`/`user_message`) remain supported for historical session files.
- **Remove the OpenCode collector**: the `opencode` entry leaves the collector registry; usage collection no longer opens `~/.local/share/opencode/opencode.db`.
- **Add a ZCode collector**: read `~/.zcode/cli/db/db.sqlite` (same `session`/`message`/`part` table family OpenCode uses, but tool names are Claude-Code-style PascalCase). Agent-initiated usage = `part` rows with `tool = 'Skill'`, taking `state.input.skill`, deduplicated by `callID`. User-initiated usage = user-message text parts whose first line starts with `/skill-name`, matched against the whitelist.
- **Drift sentinel**: when scanned Codex JSONL files contain `SKILL.md` mentions that yield no attributed usage events, log a warning so future format drift is visible instead of silent.

## Capabilities

### New Capabilities

- `skill-usage`: per-agent collection of skill-usage events from local agent conversation stores (which stores are read, which records count as user- vs agent-initiated usage, deduplication, and how unknown/undecodable data is treated).

### Modified Capabilities

<!-- None: no existing spec covers usage collection today. -->

## Impact

- `src-tauri/src/services/skill_usage.rs` — the only production file touched (collector registry, Codex/ZCode parsers, removal of OpenCode queries, sentinel).
- No frontend changes: the `SkillUsage` IPC shape is unchanged; ZCode appears wherever usage is already shown for other agents.
- No new dependencies: `rusqlite` is already in the tree; the ZCode collector reuses it.
- Agents other than usage are unaffected: OpenCode remains a manageable agent in Settings; only its usage collection goes away.
