# Proposal

## Why

Archive and restore currently put orchestration and handwritten snapshot recovery in IPC commands, where coordination depends on callers remembering guards. Repeated lookup by directory name can also confuse an agent skill with an independent SSOT skill. Establish one guarded lifecycle service and verify its failure and identity boundaries before expanding the refactor.

## What Changes

- Move archive listing/content and batch archive/restore behind a service whose write context owns the existing lease, update-exit guard and cache-refresh mutex. Inner mutations are private and require that context.
- Resolve an archiveable physical target explicitly; preserve original paths and identity on restore, including same-name agent/SSOT copies and retained imports.
- Share operation snapshots and store rollback, preserving the prior lock rather than guessing which lock entry to delete during recovery.
- Keep SSOT provenance attached to SSOT files when an independent same-name agent skill is archived. Verify this with the same scenario fixture in Rust and CLI.
- Preserve IPC names, result shapes, schema versions and ordinary-error rollback semantics. Remove legacy external-archive writes and guessed agent destinations; unsupported records/files are preserved for manual recovery. Ignore historical agent lock snapshots. The user explicitly authorized bounded historical incompatibility.
- Coordinate background SHA baselining with the local writer lease and reject stale baseline results, so it cannot interfere with lifecycle snapshots. No crash journal, dependencies, UI restructuring or headless executable is introduced.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `skill-archiving`: guarded mutation, physical identity, independent provenance preservation and rollback consistency.
- `local-protocol`: clarify which physical installation an archive lock snapshot belongs to; retain the existing v3/v1 formats.

## Impact

Rust archive commands/service and caller tests; CLI archive provenance handling and tests; desktop-owned archive scenario fixture and protocol documentation. ADR 1/3/4 remain in force. First reproduce current behavior through production functions, then migrate the same tests. This is a bounded first wave; global AppState privatization, merge/import recovery redesign, editor changes and a shared Rust/CLI engine remain outside it.
