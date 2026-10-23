# Credential Storage Hardening

## Why

A security review of the GitHub token work found two gaps in how credential-bearing state is protected: `settings.json` (which now holds the PAT) is written world-readable (`0644` with the common `umask 022`, verified on a real machine), so on a shared machine another local user can read the token at rest; and the generic `update_setting` command can still write the credential keys, while the expired-token-fallback design claims "the spec records that credential changes go through the save command". Neither the spec nor the code actually enforces that constraint. Fixing now, while the token feature is still unpushed.

## What Changes

- Add an owner-only atomic write (`0600` regardless of umask, stale temp file removed first) and use it for the two write paths that persist credential content: `Settings::save` (settings.json) and agent-transaction journal snapshots (agent-lifecycle.json, which embeds full settings.json before/after states).
- Reject the credential keys `github_token` and `github_token_expires_at` in `update_setting`, making the save command the single enforced credential write path.
- Add the corresponding github-connection requirements (single write path, owner-only at-rest permissions) and sync the main spec.
- Document the accepted trade-off that the raw token remains readable inside the renderer process via `get_settings` (CSP egress limits + zero-permission token keep this low risk).
- Not changing: the shared `atomic_write` default for other files. User-owned skill files and `.skill-lock.json` keep their current permissions. CLI journal behavior (Node side) is out of scope and is noted as a follow-up boundary.

## Capabilities

### Modified Capabilities

- `github-connection` gains credential write-path and at-rest storage requirements in the credential lifecycle this capability already owns (save, verify, expiry).

## Impact

- `src-tauri/src/persistence/mod.rs` gains a new `atomic_write_private`, used by `Settings::save`.
- Journal snapshot/recovery writes in `src-tauri/src/persistence/agent_transaction.rs` move to the owner-only helper.
- `update_setting` in `src-tauri/src/commands/settings.rs` rejects the two credential keys.
- Tests: persistence permission regression test (unix-gated), `update_setting` rejection test.
- CLI: no protocol-shape change (file contents and fixtures unchanged); the CLI never writes the credential keys. Windows is unaffected (owner-only mode is unix-gated; Windows files inherit user-profile ACLs).
