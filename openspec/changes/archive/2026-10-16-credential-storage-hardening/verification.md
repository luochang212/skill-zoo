# Verification

Date: 2026-10-15

## Gates

- `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` reports 212 passed, 0 failed (includes the three new tests below; was 210 before this change).
- `bun run test` exits 0.
- `openspec validate --all --strict` passes with 12 passed, 0 failed.
- `cargo fmt --check` is clean.

## New regression tests (red → green note)

- The test `persistence::credential_file_permissions_tests::credential_bearing_writes_are_owner_only` asserts `settings.json` has no group/other bits after save, that a stale loose `settings.json.tmp` cannot leak permissions into the next save, and that a committed agent lifecycle snapshot lands owner-only. Against the pre-change code the first assertion fails under the machine's `umask 0022` (file lands `0644`); the mask assertion (`mode & 0o077`) keeps it stable across CI umask variation once fixed.
- The test `persistence::agent_transaction::tests::uncommitted_journal_file_is_owner_only` interrupts the post-commit cleanup checkpoint so the journal survives into the crash-recovery window, then asserts the journal file is owner-only. A successful commit removes the journal (cleanup calls `recover`), which is why the surviving-journal path is the observable one.
- The test `commands::settings::tests::update_setting_rejects_credential_keys` asserts `credential_key_violation` rejects exactly `github_token` and `github_token_expires_at` with save-command guidance and passes unrelated keys.

## Verification boundary

- The `update_setting` guard wiring (the 3-line call at the top of the command) is not executed by a test: the repo's test harness calls internal functions and does not construct `tauri::State` (no tauri `test` feature in dev-deps). The predicate itself is fully tested; the wiring is a straight early return reviewed by inspection.
- Empirical facts recorded in design.md (real-machine `0644` + `umask 0022`, journal content embedding, caller inventories) were verified during the worth-fix evaluation, before this change was written.
- CLI journal writer parity (`{ mode: 0o600 }` in `packages/cli`) is intentionally deferred; see design.md Decision 5.
