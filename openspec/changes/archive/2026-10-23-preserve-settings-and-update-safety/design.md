# Design

## Context

See proposal.md. ADR 1 applies: the desktop owns settings and update behavior; no external-manager compatibility is introduced. Existing overwrite consent is carried by commands but discarded before the service replaces content. Update check results currently live in a component-owned mutation result, so resetting it removes every candidate.

## Goals / Non-Goals

Preserve existing choices and local edits with small changes to current paths. Keep the unknown-baseline/hash-error policy, plugin defaults, lock/history schemas, and file ownership rules unchanged. No new architecture or ADR is needed.

## Decisions

- Read the new show key first, then invert the old hide key, then use the unchanged effective default. Do not write a migration on read: that avoids startup writes and keeps rollback simple. Explicit user changes write the current key.
- Carry a per-item overwrite boolean into the existing update service and check drift after copying content to the replacement staging directory, directly before directory replacement. A skip leaves content and baseline unchanged. Keep the early check to avoid needless downloads. Single updates translate a late skip into the same confirmation error; batches merge early and late skips.
- Store checked server results in React Query, alongside the existing check mutation. Remove only returned successful names, marking late skips as modified. Apply the same removal for successful detail-view updates so returning to Settings cannot offer the completed item again. This avoids maintaining a second component-local copy and keeps remaining actions available without another GitHub request.
- Compose one app-wide completion toast from counts/errors and skipped names; remove the settings-only skip toast to avoid duplicate notices or losing it on unmount. Reuse existing bilingual strings.

## Worth-fix Assessment and Evidence

| Claim | Verification before fix | Probability / impact / cost / consequence | Decision |
| --- | --- | --- | --- |
| Existing hide choice is ignored | Production hook with hide_non_ssot=true returned show=true; expected-false test fails | Every upgrading user with that choice / unwanted visibility / tiny read fallback / persists until manually reset | P2, fix |
| Edits during download are overwritten | Production reinstall path: clean preflight, write local edit, prepared upstream content replaces it; expected-local-content test fails | Narrow timing window / edit loss / one per-item flag and final check / irreversible replacement | P1, fix |
| Remaining actions disappear | Rendered real settings/dialog: update clean A; modified B/C disappear; assertion fails | Common mixed lists / repeated network checks / retain server results / recurring friction | P2, fix |
| Skips can be reported as current | Actual app-wide hook after updater unmount: skipped-only and mixed-success results emit no warning; assertions fail | Users navigating during update / misleading completion / compose existing strings globally / users miss unfinished updates | P2, fix |

## Risks / Trade-offs

- One extra content hash per non-forced replacement costs local IO; it closes the much longer download/copy window. External editors do not cooperate with the app lease: hashing and rename are not an atomic filesystem compare-and-swap, so this does not claim complete protection against writes at the exact replacement instant.
- The deterministic Rust reproduction starts at the real prepared-content/reinstall boundary instead of making a live download slow. Network endpoints are hardcoded and the test home is thread-local; adding network injection solely for timing would exceed this repair's value. The async ordering is checked structurally; replacement, skip, force and content assertions use real files and production code.
- Checked candidates may become stale before a retry; existing backend SHA/preflight validation remains authoritative. Failed items remain visible so the user can recheck if needed.
- Settings reads do not alter disk state. Fixtures and desktop/CLI lifecycle recovery tests preserve both keys, including conflicts; frontend tests verify the effective choice.

## Migration Plan

No eager migration or schema bump. Current values win; legacy-only state remains readable. Deploy with the normal app update; rollback retains old settings bytes. Validation results will be added after implementation.

## Validation (2026-10-23)

- Before changes, the real-hook visibility test, rendered mixed-candidate test and unmounted-updater skip-notification tests failed on the reported behavior. The Rust prepared-content replacement test also failed: the saved local text became upstream text. All these scenarios now pass as retained regression tests.
- Final `bun run test`: 35 files, 255 tests passed. Covers the additional detail-update reconciliation, sequential clean/forced updates without rechecking, and success/failure/skip notifications after updater unmount.
- `bun run cli:test`: 12 files, 116 tests passed; `bun run cli:typecheck` passed. Shared committed/pending lifecycle fixtures preserve legacy and current settings bytes.
- `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`: 293 passed, 0 failed, 2 existing performance tests ignored. Includes final replacement drift/force/baseline assertions and shared lifecycle recovery fixtures.
- `bun run typecheck`, `bun run lint`, `bun run format:check`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, standard `cargo clippy --features test-helpers --manifest-path src-tauri/Cargo.toml -- -D warnings`, `git diff --check`, `adrkit validate --all`, and `openspec validate --all --strict` passed.
- Extra `cargo clippy ... --all-targets -- -D warnings` failed on 28 existing test-code style warnings (owned comparisons, slice clones, redundant binding, boolean assertions). Checked every reported source line against HEAD: all already existed. The project's standard Rust lint passes; unrelated test-style cleanup is excluded from this repair.
- Main specs for local-skill-scope, skill-installation and desktop-ui were synced and compared with all delta blocks. Download timing is validated at the real prepared-content boundary, not with a live concurrent network download; the final hash-to-rename interval remains non-atomic as documented above.
- Consulted modern-web-guidance for persisted preferences and the catalog's state/notification topics. No platform guide was applied: this change adjusts existing Tauri/React Query/Sonner behavior without introducing browser storage, a notification component or a new web API.
