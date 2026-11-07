# Proposal

## Why

Architecture audit findings need production-path verification before repair. CLI consistency misclassifies external imports and incomplete hashes; desktop scan and cache refresh paths disagree. Fix those bounded defects rather than reorganizing the repository.

## What Changes

- Exclude external imports from CLI consistency issues and require every duplicate candidate to have the same nonempty hash.
- Reuse concrete-root skill modeling from the single-skill scanner.
- Serialize watcher refresh with full rebuilds, batch cache writes with memory rollback, and make update commands use the existing serialized refresh path and report refresh failures.
- Delete unreachable external-import branches in new archive creation; retain historical restore support.
- Keep current module layout, filesystem ownership, local schemas, and CLI scan breadth unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-skill-scope`: clarify external-import exclusion and verified duplicate classification for CLI consistency.
- `ssot-scan`: consistent skill records across scan paths and consistent, failure-reporting cache refresh.

## Impact

CLI consistency and its filesystem tests; Rust skill service, watcher, update/archive command paths and regression tests. No dependencies or protocol format changes. ADR 1 remains authoritative; ADR 3 research boundary and ADR 4 link ownership stay unchanged. Verification evidence and per-finding worth-fix decisions live in verification.md.
