# Tasks

## 1. Persistence

- [x] 1.1 Add `atomic_write_private` in `src-tauri/src/persistence/mod.rs`. On unix it deletes a stale temp file first, then creates with `mode(0o600)`, writes, syncs, and renames. On non-unix it delegates to `atomic_write`.
- [x] 1.2 Use it in `Settings::save`.
- [x] 1.3 Use it in `agent_transaction::write_snapshots` so journal writes and crash recovery inherit owner-only permissions.
- [x] 1.4 Regression test (unix-gated): after `Settings::save` under a test home, `settings.json` mode has no group/other bits (`mode & 0o077 == 0`); a pre-created loose `settings.json.tmp` does not survive a save; journal snapshot writes (`agent_transaction::commit`) produce an owner-only `agent-lifecycle.json`.

## 2. Command guard

- [x] 2.1 In `src-tauri/src/commands/settings.rs`, `update_setting` rejects `github_token` and `github_token_expires_at` with an error pointing at the credential save command.
- [x] 2.2 Test: the credential-key guard rejects either key with an error naming the save command and passes unrelated keys. The command wiring (guard call → early return before any state access) is inspection-reviewed because the test harness does not construct `tauri::State` (see verification.md).

## 3. Specs

- [x] 3.1 Delta for `github-connection`: add "Credential keys have a single write path" and "Credential-bearing files are owner-only" requirements with scenarios.
- [x] 3.2 Sync both requirements into `openspec/specs/github-connection/spec.md`.

## 4. Gates

- [x] 4.1 `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` green.
- [x] 4.2 `bun run test` green.
- [x] 4.3 `openspec validate --all --strict` passes.
