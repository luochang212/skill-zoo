# Tasks

## 1. Registry and shared protocol

- [x] 1.1 Implement desktop-owned v1 registry persistence and immutable resolved snapshots with stable non-reused IDs; verify missing/full/invalid/future-version production-reader cases and built-in compatibility.
- [x] 1.2 Define registry, mutation lease and recoverable lifecycle journal in docs/local-protocol.md; add shared full/minimal/future/invalid/recovery fixtures and verify Rust and CLI interpret identical IDs, paths and failure semantics.
- [x] 1.3 Implement recovery and agent-related mutation coordination on both surfaces; inject failure after each affected-file write and commit marker, and verify rollback/roll-forward preserves prior files and unrelated preferences without deadlocks.
- [x] 1.4 Implement normalized name/path validation, missing-directory consent and protected-root overlap checks; test symlink aliases, nested/equal roots, Unicode names, file paths, missing paths and Windows junction/case behavior where executable (record platform limits).

## 2. Lifecycle and file ownership

- [x] 2.1 Add typed validate/preview, add, update and unregister commands plus backend directory-picker command; test built-in protection, last-visible rejection, rename identity and create-directory rollback without deleting pre-existing data.
- [x] 2.2 Preserve old-root real skills as external references on path changes/removal using production scans; verify stars/my-skills and other-agent links survive a cache rebuild, including hidden-agent and nested skill cases.
- [x] 2.3 Give existing external imports ownership precedence during agent scanning; test registration around an imported source produces one management object and never enables destructive archive/delete of that source.
- [x] 2.4 Integrate post-commit owned-link cleanup and lifecycle preview counts; test foreign/ambiguous links remain and cleanup failure reports success-with-status without reverting registration or visibility.
- [x] 2.5 Preserve archive destinations and safely handle absent custom IDs; add Rust and CLI restore cases covering renamed, path-changed and removed home/link agents, target conflicts and persistence rollback.

## 3. Shared management parity

- [x] 3.1 Replace static-only Rust agent enumeration/lookup in scan, origin/homeAgent, paths/open, scope, metadata/cache, install/update, preflight, configure, imports, consistency and archive services with one operation snapshot; parameterize meaningful production-path cases across built-in and custom agents.
- [x] 3.2 Update CLI agent validation, paths, all-target selection, scan/import/install/update, diagnostics and archive consumers; verify custom-agent arguments and shared fixtures with CLI integration tests and update CLI user documentation.
- [x] 3.3 Apply existing visibility/order and cleanup contracts to merged registrations; test add below/at/above cap, reorder, hide failure, final-visible guard and historical over-cap shrink behavior.
- [x] 3.4 Serialize lifecycle changes with target writes and revalidate registry after long install preparation; test concurrent desktop/CLI path edits or removal cannot write to stale/wrong agent targets.

## 4. Watcher, cache and capabilities

- [x] 4.1 Reconcile deduplicated watcher root coverage on add/edit/remove, retaining external coverage and attaching newly created roots; test real production event classification and registration transitions without restart.
- [x] 4.2 Refresh cache origin/homeAgent/apps and preserve metadata after lifecycle changes; test incremental edits, removal/addition and cache rebuild, and avoid full skill scans for label-only rename.
- [x] 4.3 Derive supported usage capabilities from actual collectors and expose an unsupported status for arbitrary custom tools; verify existing Claude Code/Codex/OpenCode usage tests and global Common Commands remain unchanged.

## 5. Frontend interaction and state consistency

- [x] 5.1 Extend typed API/types and query hooks, including lifecycle events and comprehensive invalidation of infinitely cached configs, paths, preferences, installed/link/conflict/archive state; test save failure rollback and removed-agent selections in open dialogs.
- [x] 5.2 Add persistent Add Custom Agent and custom-row edit actions to searched/visible/hidden manager views; verify component tests cover cap status, saved-row reveal, reorder and last-visible removal protection.
- [x] 5.3 Implement single-dialog list/editor/review transitions with labeled name/path, native picker, creation consent, validation timing and en/zh copy; test duplicate submit, picker cancel, save failure retains input and successful name/path editing.
- [x] 5.4 Implement dirty-form discard/continue, IME-safe Enter, inline accessible errors, focus/scroll restoration and removal/path-change review; verify keyboard/component tests plus manual Tab/Escape/readscreen review and no nested focus trap. (Manual Tab/Escape/readscreen pass waived by user decision 2026-10-11 — see verification.md.)
- [x] 5.5 Integrate custom targets in local/detail, install/configure, drag/drop and batch link/unlink flows; verify shared behavior tests rather than accepting only a Settings row, and retain supported-only statistics selection without the removed editor capability paragraph.
- [x] 5.6 Render/review add/edit/remove, long paths/errors and cap states at 800×600, 1280×800 and 200% text zoom in en/zh/light/dark; record screenshots and usability corrections, and verify Safari 16.4 floor without introducing unsupported load-bearing APIs.

## 6. Integration and performance evidence

- [x] 6.1 Complete every row of design.md's parity matrix with observed evidence, audit remaining static registries and agent-ID dispatch, and verify all differences are origin/tool-specific rather than missing custom-agent management features.
- [x] 6.2 Benchmark production scan/path-detection/incremental/lifecycle operations against recorded baseline using 0/5/20 custom roots and 100/1,000 skills; report median/p95, registry load/allocation counts and incremental scan cost, meeting the documented zero-custom regression budget.
- [x] 6.3 Run bun run test, bun run typecheck, bun run lint, bun run format:check, bun run cli:test, bun run cli:typecheck, cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml, and Rust format/clippy checks; record actual outcomes and any platform verification limits.
- [x] 6.4 Run openspec validate --all --strict, verify implementation against all delta scenarios and unchanged installation/scope/archive/UI contracts, and write verification evidence including file-preservation and concurrency outcomes.

## Workflow follow-up

- Sync affected main specs and archive after implementation verification; confirm no stale main-spec behavior or placeholder purpose remains.

## 7. Discovered upgrade boundary

- [x] 7.1 Implement the agreed future-built-in reconciliation: allow disjoint same-name entries, suppress overlapping built-in defaults with a management explanation on desktop and CLI, preserve stable IDs/bytes/preferences and external ownership on reactivation, and verify shared fixtures, aliases, metadata, cap and startup compatibility.
