# Tasks

## 1. Content-tree verification helper

- [x] 1.1 Add a local directory content-tree SHA helper beside the carrier logic (`services/lock.rs` or a sibling module) implementing git object hashing (blob/tree SHA-1, git tree sort with directories sorted as `name/`, modes `100644`/`100755`/`120000`, nested trees); return `Result<String, AppError>` with the directory-missing case surfaced — verify with a property test against real `git` object hashing on representative directories (nested dirs, exec-bit file, symlink, unicode filenames)
- [x] 1.2 Add the field-evidence oracle test: the helper must reproduce the recorded tree SHA for a fixture directory matching the documented `openspec-explore` shape (single SKILL.md, tree `83b5a650…` recorded in the change's field notes) — verify `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` passes the oracle case

## 2. Verified conflict resolution in the desktop paths

- [x] 2.1 Implement the shared resolver: conflicted entry + local content tree SHA equal to exactly one carrier → align both carrier fields via `SkillLock::update` under `AgentLease`, touching no other entry field; directory missing or SHA matching neither → leave the entry unchanged — verify with Rust unit tests covering align-to-carrier, align-to-mirror, unresolvable-keeps-state, and no-field-drift (unknown fields preserved) cases
- [x] 2.2 Wire the resolver into the check pipeline target building (`commands/settings.rs`) so conflicted-but-verifiable entries are aligned before status building and do not surface as `baselineConflict` once the alignment is durable; if the lease or write fails, the entry keeps the conflict state and is reported as `baselineConflict` — verify with Rust tests: legacy conflicted entry through `check_skill_updates` reports a normal state and writes only the aligned carriers; a held lease leaves the lock bytes and conflict state untouched
- [x] 2.3 Wire the resolver into the shared batch filter (`CliService::filter_updatable_candidates`) and the checked-update prefilter (`checked_update_entries_from_lock`) so verifiable entries proceed and unresolvable ones keep the explicit `[baselineConflict]` refusal — verify with Rust tests: batch update heals and updates a verifiable entry; unresolvable entry is refused with its entry unchanged
- [x] 2.4 Wire the resolver into the single-update path (`update_skill_inner`) ahead of the pin/conflict refusals so a direct update of a verifiable conflicted entry proceeds — verify with a Rust test replicating the field failure (externally installed carrier + pre-dual-baseline app carrier, local content matching one): update succeeds and both carriers are rewritten to the installed content
- [x] 2.5 Assert the idempotency property: after alignment, repeated checks make no further lock write while the carriers agree, and the entry keeps participating like any unconflicted skill — verify with a Rust test (align via check → lock bytes snapshot → second check → lock bytes unchanged)
- [x] 2.6 Complete the documented refusal contract for these states: pin/conflict/missing-baseline batch refusals use `directory: [code] message`, single updates return stable `CommandError` codes, a missing baseline is refused before network work with reinstall/external-repair guidance, and a refusal that follows an alignment leaves the alignment recorded — verify with Rust tests covering the stale-pre-alignment checked request and the no-network missing-baseline refusal

## 3. Protocol surface (docs + fixtures + cross-runtime tests)

- [x] 3.1 Update `docs/local-protocol.md`: carrier read order gains the verified-resolution rule (align both carriers to the locally verified value; missing directory or matching-neither keeps the conflict); the "Update checks never write baselines" rule gains the recorded-value exception; the External baseline repair section covers carrier disagreement — verify the doc's read-order paragraph matches the delta spec wording with no contradiction (consistency pass)
- [x] 3.2 Add `fixtures/local-protocol/lock-v3-legacy-conflicts.json` encoding the field-evidenced shapes: conflict where local content matches the carrier, conflict matching the mirror, conflict matching neither, and a directory-less conflicted entry — verify the fixture loads and its SHA relationships hold via a fixture test
- [x] 3.3 Extend desktop protocol fixture tests (`protocol_fixtures_test.rs`) to exercise the resolution matrix and the alignment write against the new fixture through real filesystem state; the end-to-end check/update entry points are covered by the provenance tests with the same field-evidenced shapes — verify `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` green
- [x] 3.4 Extend the CLI fixture test (`packages/cli` protocol tests) to assert the CLI still preserves the conflicted entries field-for-field end-to-end (scan → archive → restore; lock key order may change) on the new fixture — verify `bun run cli:test` green (CLI behavior unchanged per proposal)
- [x] 3.5 Run the sync checks for the whole change: `openspec validate --all --strict`, `adrkit validate --all`, `bun run lint && bun run typecheck && bun run test`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, and `cargo clippy --manifest-path src-tauri/Cargo.toml --features test-helpers -- -D warnings` — verify all green

## 4. Frontend verification

- [x] 4.1 Confirm no frontend changes are required: conflicted entries disappear from the check UI only because the backend stops reporting them; the `baselineConflict` issue label remains reachable for unresolvable entries — verify via existing frontend tests (`bun run test`) staying green and, if any frontend test pinned the old refusal text, updating it in the same commit

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied; sync the four MODIFIED requirements into `openspec/specs/local-protocol/spec.md` at archive time.
