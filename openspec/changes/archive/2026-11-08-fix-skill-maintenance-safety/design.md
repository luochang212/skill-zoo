# Design

## Context

See proposal.md. ADR 1 owns the desktop protocol; ADR 6 owns lifecycle guard ordering. Keep existing command guards and lower-level staging/copy protections; do not introduce a second transaction framework.

## Goals / Non-Goals

**Goals:** Remove demonstrated maintenance failures at the existing shared boundary. Preserve per-skill partial success and local-edit protection.

**Non-Goals:** Process-crash atomicity, whole-batch rollback, all-application cache deletion, vendor-specific plugin layouts, virtualized rendering, or relocating all update orchestration.

## Decisions

1. Read the git archive commit from the same ZIP handle used for extraction; query the tree by this immutable commit. Verify each checked folder SHA before copying/replacing. Git documents the ZIP comment commit identity (https://git-scm.com/docs/git-archive); a live GitHub Hello-World ZIP also supplied a 40-character commit comment. This avoids persisting repository commits or changing IPC/lock shape. A branch-only second check cannot bind bytes to a version; a folder tree SHA is not a repository commit and cannot simply be used as an archive ref.
2. Missing/unusable ZIP identity is safe degradation: install stores unknown version, update fails before replacing files. One tree lookup per repository update is the cost of using an already downloaded archive rather than adding snapshot fields to checks.
3. Move each skill's lock commit inside the existing directory replacement/rollback boundary. Hash prepared content before replacement and keep the backup until publication succeeds. Failed sibling updates do not undo already successful skills. No generic transaction executor; existing caller exit guards/leases and refresh coordination remain.
4. Delete auto-baselining: remote state cannot prove local installed version. Existing issue UI explains recovery through explicit detail update. Shared fixture verifies both readers preserve null commitSha with a valid content hash.
5. Use the existing React Query cache for cache size and refreshed plugin results. The mutation hook owns persistence plus refresh so navigation does not discard a component callback; pending blocks repeated toggles. Existing house ToggleRow already supports disabled.

## Risks / Trade-offs

- [ZIP commit absent or tree unavailable] → Updates fail safely; installs remain readable with an unknown version. No fallback to a mutable branch baseline.
- [Per-skill lock writes cost more than one batch write] → Only updated skills are written, preserving coherent partial results and ordinary error recovery.
- [External edits between the last hash and rename] → Existing residual filesystem race remains; this change does not claim a global filesystem transaction.
- [Plugin scan remains slow] → Timing is retained as evidence; pending feedback/result reuse are justified now, scanning/virtualization redesign awaits finer attribution.

## Migration Plan

No migration or schema bump. Existing known versions remain unchanged; previously missing versions are surfaced instead of invented. docs/local-protocol.md and shared fixtures/tests change together.
