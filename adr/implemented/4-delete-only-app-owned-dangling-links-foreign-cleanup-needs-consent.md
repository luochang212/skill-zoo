---
status: implemented
date: 2026-10-24
raised-by: agent
decided-by: human
created: 2026-10-24
commit: 5cd578f
tags:
  - filesystem
  - data-safety
  - scanning
paths:
  - src-tauri/src/services/skill.rs
  - src-tauri/src/commands/agents.rs
---

# ADR: 4 Delete only app-owned dangling links; foreign cleanup needs consent

## Problem

Scan-time cleanup used to delete every dangling symlink or junction it found in
agent skill directories, regardless of who created the link. Scans run at
startup and on watcher events, so any momentary state gets multiple chances to
be observed as garbage.

Agent skill directories demonstrably contain links the app did not create.
Users symlink individual skills or whole `~/.claude/skills` directories to
dotfiles repos, `~/.agents/skills`, or git submodules
([claude-code#36659](https://github.com/anthropics/claude-code/issues/36659),
[#38051](https://github.com/anthropics/claude-code/issues/38051),
[skills#293](https://github.com/vercel-labs/skills/issues/293)), and dangling is
often transient: a deinitialized submodule or a target directory mid-reorg.
Deleting such a link is silent and irreversible. The old rule also deleted
Skill Zoo's own protocol links: an `origin=agent` link pointing at another
agent's home directory is indistinguishable from a foreign one at scan time,
so a scan during a user's reorganization removed links the app itself had
created.

Ecosystem evidence that dangling states are a population, not a tail: a
competitor carries a `symlink_valid` field precisely because users move or
delete target files (see the OPC-Skiller dossier under
`openspec/changes/archive/2026-10-14-research-competitor-skill-managers-co-design/evidence/dossiers/`),
and dotfiles tooling (Tuckr) ships dangling-link checkers that report rather
than delete. No mainstream manager silently deletes links it did not create.

## Decision

- Automatic cleanup may remove only links the app owns: those whose lexical
  target lies inside `~/.agents/skills/`, or, on operation paths that know the
  home set, inside a known agent home directory (`is_app_owned_link`).
- Foreign or unclassifiable dangling links are never silently deleted. They
  stay in place.
- Ownership is inferred from the link target's location, not recorded at
  creation, and the inference is deliberately biased toward under-deletion.
  Both approximation errors are accepted: a user-made link into SSOT may be
  cleaned as ours; an app-made link to an agent home may survive as clutter at
  scan time.
- The sanctioned extension for foreign links is a consent-based surface: list
  them with their target paths and remove them only on explicit user action.
  Ownership defines the default; consent extends the boundary.

## Alternatives considered

- **Keep deleting all dangling links.** Rejected: it destroys user-created
  links based on a point-in-time existence check, and the failure surfaces
  only when the target returns. It even deleted the app's own `origin=agent`
  links during user reorganizations.
- **Never delete anything, including app-owned litter.** Rejected: links left
  by interrupted operations or externally deleted SSOT entries would
  accumulate forever with no self-healing.
- **Record creator metadata on links.** Rejected: symlink semantics carry no
  creator information; sidecar bookkeeping for a cleanup heuristic costs more
  than the clutter it prevents.

## Consequences

Silent irreversible deletion of entries the app does not own is off the table,
and the app's own cross-agent links survive user reorganizations. In exchange,
foreign dangling links can accumulate with no cleanup path yet, and scan-time
cleanup misses app links to agent homes because the scan call site passes an
empty known-home set. Both are visible, recoverable clutter rather than data
loss.

### Verification

The regression test `scan_keeps_foreign_dangling_links_but_cleans_app_owned_ones`
in `src-tauri/src/services/skill.rs` pins both sides of the boundary. The
finding history and evidence are in
`docs/reviews/2026-10-24-code-review-triage.md`.

### Trade-offs

The low-occurrence argument does not reverse this choice. If foreign dangling
links are rare, keeping them costs nothing and unconditional deletion buys
nothing; deletion only pays off in the world where such links do occur, which
is exactly the world where transient states make deletion dangerous.

### Follow-ups

- Build the consent-based cleanup surface: list foreign dangling links with
  their target paths and offer one-click removal.
- The queued crash-window recovery sweep must apply the same ownership
  boundary to orphan temp directories and links.
