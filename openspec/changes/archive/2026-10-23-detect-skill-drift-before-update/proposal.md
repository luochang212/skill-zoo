# Proposal

## Why

The desktop app ships a full skill editor and treats the filesystem as the source of truth, so users are encouraged to edit installed skills. Yet the update flow compares only the repository-side folder SHA (`commitSha`) and never looks at local content. Updating a skill the user has modified silently discards their edits. The lock already reserves a `skillFolderHash` field (present in `docs/local-protocol.md` and `fixtures/local-protocol/lock-v3-full.json`), but the desktop never computes a real value: every write path stores `None` or an empty string.

## What Changes

- Give `skillFolderHash` real semantics: a deterministic SHA-256 over the installed skill's regular files, computed and written to the lock entry when a remote install or an update completes.
- Before applying an update, recompute the hash of the installed folder and compare it with the lock entry. A mismatch marks the skill as locally modified (drifted).
- A drifted skill is not overwritten silently: single updates require explicit confirmation that local edits will be lost, and batch updates skip drifted items and report them in the completion summary with a per-item force-overwrite action.
- Entries without a usable baseline hash (legacy locks, `None` or empty string) keep today's behavior: the update proceeds without a drift warning, and the next successful install/update writes the baseline going forward.
- Document the hash definition and write points in `docs/local-protocol.md`, extend `fixtures/local-protocol/`, and cover both desktop and CLI protocol tests. The CLI stays read-only: it gains no write commands, it only tolerates the now-populated field it already parses.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `skill-installation`: Add the missing update-flow requirements. Update compares local content against the stored baseline, protects drifted skills from silent overwrite, and records a fresh baseline whenever content is (re)written.
- `local-protocol`: Add the `skillFolderHash` contract covering how the hash is computed over the installed folder, when it is written, and how readers treat missing or empty values.

## Impact

- `src-tauri/src/services/cli.rs` (hash computation, drift check in update-check and update paths), `src-tauri/src/services/lock.rs` (no schema change; the optional field exists), update manager frontend (`src/`) for the drifted state, confirmation and batch summary, plus EN/ZH strings.
- `docs/local-protocol.md`, `fixtures/local-protocol/` (a populated-hash lock fixture and a legacy empty-string case), Rust protocol tests and `packages/cli` protocol tests.
- No new dependencies; hashing uses existing SHA-256 support in the Rust dependency tree. Local (non-repo) skills have no lock entry and are untouched. Rollback/backup flows are unchanged; the baseline is only rewritten after a confirmed successful write.
