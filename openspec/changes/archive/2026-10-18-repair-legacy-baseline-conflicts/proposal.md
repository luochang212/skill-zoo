# Proposal

## Why

The dual-baseline conflict guard (E1) flags entries where `skillFolderHash` and `commitSha` disagree, and refuses all update paths for them. Field evidence shows this state is routinely produced by the *legacy* write pattern interacting with external tools: `gh skill`/`npx skill` install an entry (recording `skillFolderHash`), then the pre-E1 Skill Zoo update flow rewrites only `commitSha` while preserving the foreign field. On one real machine, 22 of 68 lock entries — every externally-installed skill that Skill Zoo had ever updated — hit the conflict, with all update attempts refused and no in-app remedy except per-skill reinstall. Every user who upgrades carries the same latent state.

Investigation of that machine also showed the conflict is usually resolvable *without* any user decision risk: for 7 of 8 reachable entries, the locally installed content's tree SHA byte-matched one of the two recorded carriers (and matched the remote tip), so the "conflict" was pure bookkeeping divergence between two writers, not an unknown-content situation.

## What Changes

- Add a verified-conflict resolution: whenever the desktop evaluates a conflicted entry (update checks, single update, batch and checked update paths), it computes the installed directory's content tree SHA; if that SHA equals exactly one of the two recorded carriers, both carrier fields are aligned to that locally verified value and the entry proceeds normally (up-to-date or update offered, depending on remote).
- Entries whose local content matches neither carrier, or whose installation directory is missing, keep the existing explicit conflict state requiring user decision (reinstall) — unchanged conservative behavior.
- Amend the "update checks never write baselines" rule with a precise exception: a check may write only a value **already recorded in the entry itself** and **verified byte-identical to the installed content**; it still never writes a network-time or guessed value.
- Update `docs/local-protocol.md` (conflict read order gains the verified-resolution rule; external-baseline-repair section covers carrier disagreement), and add a protocol fixture encoding the legacy conflicted-entry shapes.
- CLI behavior is unchanged: the CLI never repairs (its boundary stays scan → archive → restore preserving lock bytes); it only benefits from desktop-aligned entries.
- The alignment is an independent permitted write: a later refusal or failure of the requested update does not undo it. The refused-update preservation requirement gains that explicit exception.
- Batch update refusals now use the already-documented `directory: [code] message` shape and single updates return stable CommandError codes for pin/baseline states; a missing baseline is refused before network work, with the message pointing at reinstall or external baseline repair instead of an update check that cannot unblock it.

Out of scope: garbage collection of stale lock entries whose installation directories no longer exist (they are invisible to the check UI and do not block anything; a separate change can own that if wanted).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `local-protocol`: the carrier read-order requirement, the "checks never write baselines" requirement, the conflict-surfacing requirement, and the refused-update preservation requirement gain the verified local-content resolution path and its boundary cases (missing directory, content matching neither carrier, pinned entries, alignment surviving a later refusal).

## Impact

- Rust: `src-tauri/src/services/lock.rs` (content-tree helper may live beside the existing carrier logic), `src-tauri/src/services/cli.rs` (`filter_updatable_candidates` / update entry points), `src-tauri/src/commands/skill.rs` (`update_skill_inner`, `checked_update_entries_from_lock`), `src-tauri/src/commands/settings.rs` (check-target building). Tree-SHA computation of a local directory (git object hashing) must match the recorded carrier semantics.
- Protocol surface: `docs/local-protocol.md`, `fixtures/local-protocol/` (new legacy-conflict fixture), desktop and CLI protocol tests per the local-protocol guardrails.
- No frontend changes expected: repaired entries simply stop appearing as conflicts; the existing `baselineConflict` issue state remains for unresolvable entries.
- No lock format change: lock v3 fields are reused; only the two existing carrier values are rewritten to a value already recorded in the entry.
