# Tasks

## 1. Codex collector: current rollout formats

- [x] 1.1 Extend `parse_codex_skill_line` to attribute agent-initiated usage from `custom_tool_call` records named `exec`, extracting `skills/<name>/SKILL.md` via the existing regex; unit test feeds a real-shaped record (`tools.exec_command({cmd:"cat …/skills/<name>/SKILL.md"})` string input) and asserts the agent event, plus asserts an `apply_patch`-style custom call mentioning a `SKILL.md` path is ignored.
- [x] 1.2 Extend user-message detection to `response_item` records with `role: "user"` text blocks, reusing the `$`-prefix extractor; unit test asserts a user event from a current-shaped record and a user event from the legacy `event_msg` shape (both fixtures stay green).
- [x] 1.3 Implement the mirror-duplicate dedup fallback: message/session identifier when present, else a text fingerprint (~80 chars) as the dedup id; unit test feeds a legacy `user_message` line and its `response_item` mirror and asserts one event.
- [x] 1.4 Run `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml skill_usage` and verify all Codex tests pass.

## 2. Registry: remove OpenCode, add ZCode

- [x] 2.1 Replace the `opencode` registry entry with `zcode` and rename/retarget the SQLite collector to `~/.zcode/cli/db/db.sqlite` with adjusted field paths (`$.tool = 'Skill'`, `$.state.status = 'completed'`, `$.state.input.skill`, `$.state.time.start` falling back to row `time_created`, `$.callID` dedup); unit tests port the existing opencode cases (extract, dedup, whitelist, missing db) onto ZCode-shaped rows and pass.
- [x] 2.2 Add the user-side query: text parts joined to user-role messages whose text starts with `/`, first token normalized and whitelist-matched; unit test inserts a `/code-review` text part and asserts one user event, and a non-whitelisted `/nope` asserting no event.
- [x] 2.3 Open the database with SQLite read-only flags and verify a simulated open failure returns empty usage without error (port of the missing-db test).
- [x] 2.4 Grep the crate for remaining `opencode` usage references and verify none affect usage collection (agent-management code is untouched).

## 3. Drift sentinel

- [x] 3.1 Track `SKILL.md`-mentioning files while streaming Codex lines and emit one `log::warn!` listing up to a few files when zero events were attributed; unit test writes a file containing a `SKILL.md` mention that parses to nothing (e.g. prose mention only) and asserts the warn path, plus a control asserting no warning when events are attributed.
- [x] 3.2 Verify the warning fires end-to-end by pointing a temp-home fixture at a mention-only Codex tree and observing the log output in test stderr.

## 4. Integration verification

- [x] 4.1 Run the full backend suite `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` and verify no regressions outside skill_usage.
- [x] 4.2 Run `bun run lint` and `bun run format` and verify the tree is clean (Rust formatting via `cargo fmt --check` on touched files).
- [x] 4.3 Spot-check against live local data: build a small integration test or manual run that points discovery at the real home directories and confirms Codex and ZCode both yield non-zero attributed events consistent with the investigation counts (ZCode ≈ 358 Skill parts before whitelist filtering).

## Workflow follow-up

- Sync `openspec/specs/skill-usage/spec.md` into the main specs on archive (new capability created by this change).
- Archive the change after the project's review requirements are satisfied.
- Verify the archived result.
