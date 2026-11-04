# Design

## Context

`src-tauri/src/services/skill_usage.rs` owns collection: a static registry maps one `agent_id` to one collector function, and each collector returns `(events, installed_count)` that shared aggregation code turns into the `SkillUsage` IPC payload. Claude Code and Codex collectors stream JSONL line by line through a caller-supplied line parser; the OpenCode collector queries SQLite with `rusqlite`. All fixtures and unit tests still encode the pre-drift formats (see proposal for the drift evidence).

## Goals / Non-Goals

**Goals:**

- Codex parsing matches both current and historical rollout formats, without double-counting.
- ZCode replaces OpenCode in the registry with minimal new surface, reusing the SQLite-query approach.
- Future Codex format drift produces a visible warning instead of silent zeros.

**Non-Goals:**

- A DeepSeek Harness collector (no local install yet; the registry makes adding one cheap later).
- Reading ZCode legacy snapshots (`~/.zcode/v2/sessions/*.json`) or `~/.zcode/projects/*.jsonl` transcripts (absent on current installs; the SQLite db is the complete source of truth).
- Removing OpenCode as a manageable agent — only its usage collection goes away.
- Indexing/caching layers for the ZCode database (refresh cost is already sub-second on a ~1 GB db with plain `json_extract` scans, measured during investigation).

## Decisions

**Keep the one-function-per-agent registry.** The registry stays a static slice of `(agent_id, collector)` entries; `opencode` is removed, `zcode` is added. A config-driven generic collector was considered and rejected: three bespoke formats do not share a schema, and the registry is three entries today.

**Codex: additive dual-format parsing.** The Codex line parser accepts the union of old and new shapes:

- Agent-initiated: any tool call whose command text references `skills/<name>/SKILL.md` — legacy `function_call` records (JSON-encoded `arguments.cmd`) and current `custom_tool_call` records named `exec` (raw string input embedding `tools.exec_command({cmd:"…"})`). The existing path regex extracts the name from either carrier. The `exec` name check is deliberate: `apply_patch`-style custom calls can legitimately mention a `SKILL.md` path inside a diff, and counting those would fabricate usage — same reason legacy parsing only looked at `exec_command`.
- User-initiated: `$skill-name` prefix found in legacy `event_msg`/`user_message` payloads and in current `response_item` records with `role: "user"` whose content blocks carry text. The existing `$`-prefix extractor is reused.

Deduplication across the two user-message carriers: current Codex emits `response_item` messages and mirrored event records for the same turn, so a transitional file could yield the same user message twice. When a record carries a message/session identifier it keys the dedup set as today; otherwise the dedup id falls back to a fingerprint of the message text (first ~80 characters). A repeated identical invocation collapses to one event — acceptable for period-level statistics, and covered by a unit test.

**ZCode: port the OpenCode query shape with adjusted field paths.** Two read-only queries against `~/.zcode/cli/db/db.sqlite`:

- Completed Skill tool parts: `part` rows where `$.tool = 'Skill'` and `$.state.status = 'completed'`; skill from `$.state.input.skill`, timestamp from `$.state.time.start` (falling back to the row's `time_created`), dedup by `$.callID`. Verified against live data (358 rows; rows lacking `input.skill` are dropped by the whitelist as intended).
- User slash-command text: text parts joined to user-role messages whose text starts with `/`; the first token after the slash is normalized and matched against the whitelist. ZCode writes no `command-name` markers (verified: the only `<command-name>` occurrences in the local db are prose).

The database is opened with SQLite read-only flags: ZCode may be running and the db is WAL-mode, so the collector must never create write locks; any open/query failure degrades to empty usage per the robustness requirement.

**Sentinel: count SKILL.md mentions during the existing stream.** While the Codex collector streams lines it already has each line in memory, so a substring check records which files mention `SKILL.md`. If such files exist but produced zero attributed events, emit one warning line naming up to a few affected files. The app has no logging subscriber today (no `log`/`tracing` dependency — the design originally assumed the facade was wired in, which proved wrong during implementation), so the warning goes to stderr via `eprintln!` with a `[skill_usage]` prefix: visible in the dev console and test output, zero new dependencies. Swap to the logging facade when the app gains one.

## Risks / Trade-offs

- [Codex format is officially unstable and will drift again] → The parser accepts a union of formats rather than the latest one, and the sentinel turns the next drift into a log line instead of silent zeros.
- [Text-fingerprint dedup can collapse legitimate identical repeat invocations] → Accepted: period statistics tolerate under-counting identical repeats; ids take precedence whenever records carry them.
- [ZCode's schema is undocumented from our side; tool names could change casing again] → The whitelist filters garbage by construction, and a zero-event result on a db that contains Skill parts is exactly what the sentinel pattern (extensible to ZCode later) is meant to surface.
- [Reading a live WAL database from another process] → Read-only flags and graceful degradation to empty usage; refresh is user-triggered, so transient lock contention just means empty stats until the next refresh.

## Migration Plan

No data migration: collection is read-only and stateless. Rollback is reverting the commit. The only user-visible transition is OpenCode usage statistics disappearing from views (accepted per proposal) and Codex/ZCode figures changing as new formats start counting.

## Open Questions

None — field paths and record shapes were verified against real local data during investigation.
