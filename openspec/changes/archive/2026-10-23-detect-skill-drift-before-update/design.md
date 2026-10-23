# Design

## Context

`SkillLockEntry` already carries `skillFolderHash` (`src-tauri/src/services/lock.rs`), the field is documented in `docs/local-protocol.md`, present in `fixtures/local-protocol/lock-v3-full.json`, and parsed by the CLI (`packages/cli/src/protocol/types.ts`). However, no code path computes a real value: install/update paths store `None`, and one site writes an empty string. The update flow (`CliService::known_update_from_tree`) decides "needs update" purely from repo-side folder SHAs. See the Why section of proposal.md.

## Goals / Non-Goals

Goals:

- One deterministic content baseline per repo-installed skill, written at install/update completion.
- Drift detection at update-check and update time, with an explicit user gate before overwriting.
- Protocol parity: docs, fixtures, and both surfaces' tests updated in the same change.

Non-Goals:

- No undo/history for user edits and no three-way merge. The choice is binary: keep local edits or take the repository version.
- No CLI write commands; the CLI keeps reading and preserving the field.
- No drift tracking for local (origin=agent) or external-import skills, which have no lock entry and remain fully user-owned.
- No change to archive/remove/restore semantics.

## Decisions

**Hash definition: single scalar SHA-256 over the folder's regular files.** Walk the installed folder recursively; skip symbolic links (dirs and files, never follow); sort entries by relative path bytes; feed `relative-path (UTF-8) + 0x00 + file bytes` for each regular file into SHA-256; store lowercase hex. Empty folder hashes the empty input. The same recursion depth cap as install applies.

*Why not per-file manifests in the lock:* the protocol field is one string; a manifest would grow the lock linearly with skill size and demand a new schema version. *Why not mtimes:* restore, copy and cross-machine moves change mtimes without content changes; only content honesty matters here. Raw bytes are hashed with no BOM/CRLF normalization, because for "will this overwrite your edits?" a byte difference is a difference.

**Write points: exactly two.** (1) After a remote install finishes writing into the SSOT store; (2) after an update has swapped in new content (including a user-confirmed drift overwrite). Both go through the existing `SkillLock::update` read-modify-write, so no new locking rules. The empty-string write site is removed as part of the tasks. Baseline writes happen only after the content write is confirmed successful; the existing backup/restore failure path therefore never invalidates a baseline.

**Compare point: inside the update-check/update pipeline.** The check already holds the lock entry and needs no network for this, so drift is computed where `commitSha` comparison happens and carried on the update item as a third state: `up-to-date / update-available / update-available-and-drifted`. Recomputing at update time (not just check time) guards against edits made between check and apply.

**Gate placement: update manager, not the write path.** The backend accepts a force flag on the update command; the drift verdict comes from the backend, but the decision is UI. Single update: the manager shows a confirmation ("this skill was modified locally; updating replaces your edits"). Batch: drifted items are excluded from the auto-applied set, listed in the completion summary, and each offers an explicit "update anyway" action. Skills without a usable baseline never gate.

**Unknown-baseline handling: silent fallback.** Missing or empty hash, or a hashing error at compare time (unreadable file, permission denied) → treat as "cannot judge", proceed exactly as today, and never claim drift. A false "you edited this" is worse than no warning. The next successful install/update write repairs the baseline naturally.

## Risks / Trade-offs

- [Hashing cost on very large skills] → recursion-depth-capped walk over regular files only; skills are text-sized in practice, and the walk runs once per update-check item, not per file view.
- [Symlink-only changes are invisible] → install already refuses pathological symlink layouts; a skill whose only change is an internal symlink target is out of scope and documented in the protocol doc.
- [Users habituate to confirming drift dialogs] → batch updates skip instead of nagging; the confirmation appears only on explicit single-skill updates, and the summary makes skipped items actionable in one click.
- [Older desktop versions read locks with populated hashes] → the field is already in the schema as optional; older readers ignore the value. No migration.

## Migration Plan

Additive: no lock version bump, no fixture breakage (`lock-v3-full.json` already carries a populated value). Ship order within the change: protocol doc + fixtures + dual tests first, then backend compute/compare, then UI. Rollback is a plain revert; locks written with baselines stay readable.

## Open Questions

None.
