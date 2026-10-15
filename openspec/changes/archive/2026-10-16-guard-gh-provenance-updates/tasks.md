# Tasks

## 1. Strict detection and protocol

- [x] 1.1 Implement tri-state YAML inspection/read wrapper and shared YAML matrix; verify Rust parser/boundary cases.
- [x] 1.2 Document refusal, compatibility and information limits; sync local-protocol spec and shared fixtures; verify real CLI scan/archive/restore preserves bytes.

## 2. Update authorization and issues

- [x] 2.1 Guard single/all/checked/direct/reinstall paths and retain pre-network snapshots; verify zero-network refusal, mixed ordinary success, byte/entry preservation and barrier-controlled updateStateChanged.
- [x] 2.2 Add prioritized Check issues, candidate exclusion and zh/en text; verify backend Check and frontend interaction tests.

## 3. Integration verification

- [x] 3.1 Run all requested Rust/frontend/CLI tests, typechecks, lint, Rust format, OpenSpec strict validation and diff check; repair failures and record evidence.
- [x] 3.2 Run read-only gh v2.102.0 list if present and produce /tmp/codex-c2-report.md with files, semantics, gates, results and boundaries; leave changes uncommitted.

## Verification evidence

- Rust full suite: 290 passed, 0 failed, 2 existing ignored; includes 12 C2 behavior tests and desktop protocol fixtures. `SKILL_ZOO_TEST_GH` selected gh v2.102.0 for the real read-only before/after sourceURL/version assertion.
- Shared YAML contract: 54 cases, including actual gh text, reserved-key variants, aliases/merges, CRLF/BOM and unsafe inputs.
- Frontend: 33 files / 211 tests passed; CLI: 13 files / 116 tests passed.
- Both typechecks, lint, Rust formatting, frontend format check, OpenSpec strict validation and git diff whitespace check passed.
- Implementation and checks ran on macOS. No Windows/Linux runtime execution was performed. No commit, push, archive, B1 association change or C1 projection was performed.
