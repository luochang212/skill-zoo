# Proposal

## Why

The skill lifecycle refactors (merge, external import, repository discovery) landed as behavior-level changes whose specs were not synced at the time. Per the local-protocol guardrails, behavior-level changes must sync the main specs or the specs go stale. This change records the decision and syncs the specs after the fact, following the same pattern as the archived `refactor-skill-archive-lifecycle` change.

## What Changes

- Add a `skill-merging` capability spec covering what merge verification, staging and rollback MUST guarantee: live ownership/content verification before destructive moves, same-filesystem staging of originals and pre-existing cross-agent links, cache/metadata commit only after both saves succeed, complete prior-state recovery on failure with disclosed incomplete recovery, preservation of external/plugin namesakes, union migration of user flags, and rollback (instead of log-and-continue) when link creation fails.
- Extend the `local-protocol` spec's external-import requirements with the new import guards: duplicate physical sources and colliding flat link names are rejected before writing, SKILL.md must be a real file, the registry snapshot (not per-entry bookkeeping) owns rollback, a failed batched cache commit aborts the operation and restores the registry while preserving pre-existing links and original import timestamps.
- Record that repository browsing and installation share one candidate traversal (`SkillService::repo_skill_roots`) with unchanged observable semantics; no spec delta is needed for it, so it is documented in design only.

## Capabilities

### New Capabilities

- `skill-merging`: The merge-duplicates-into-SSOT lifecycle contract — verification, staging, commit ordering, rollback and preservation guarantees.

### Modified Capabilities

- `local-protocol`: External import registration gains pre-write guards and snapshot-based rollback semantics.
