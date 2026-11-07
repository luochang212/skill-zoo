# Verification — archive lifecycle refactor

## Scope and structural result

This is the first bounded lifecycle refactor, not a claim that the whole repository now has a clean architecture. `commands/skill.rs` delegates all archive operations to `services/skill_archive.rs`. Private per-item mutations require `ArchiveWrite`, which owns the local writer lease, cache-refresh mutex, update-exit guard and current imports registry. `ArchiveTarget` resolves the physical source and its owner; `ArchiveSnapshot` captures and recovers cache, metadata, manifest and lock state. Filesystem compensation stays explicit in each operation; no transaction framework or dependency was added.

The improvement is ownership of invariants, not file size. Moving the old bodies alone would not solve the defects: restore now scans the concrete home, only SSOT owns installation provenance, mutation targets are revalidated, and recovery restores the actual prior lock. State locks are released before recovery. Incomplete recovery is included in the returned error instead of only logged.

ADR 1 (desktop-owned local protocol), ADR 3 (no production verification dependency) and ADR 4 (preserve foreign links) remain authoritative. These changes stay within them. Shared fixtures and local-protocol documentation preserve the changed compatibility rules; no new ADR is necessary to duplicate those owners.

## Reproduced defects and regressions

Tests call the real batch service/CLI operations against temporary homes, not a substitute implementation.

- Before the refactor, an agent/SSOT same-name roundtrip returned `ssot:demo` instead of `agent:codex:demo`. Scanning the concrete restored home fixes the identity and metadata association.
- Both runtimes removed the independent SSOT lock while archiving an agent skill. Both also applied a historical agent lock snapshot over a different current SSOT record. Shared roundtrip cases now preserve that lock and its unknown optional fields.
- The old desktop archive path accepted a cached source without SKILL.md, a retained external import mislabeled as agent-owned, and a physical source outside the recorded owner's root. Each regression now fails before moving files.
- The old background commit-SHA writer wrote successfully while another local writer held the lease. It now cooperates with that lease and compares the exact checked entry before filling a missing SHA; replacement installations/newer SHAs are preserved.
- The old CLI guessed a destination for agent archives without their original home. This deliberately unsupported case now fails without moving files.

Additional checks cover eight real cache/metadata/manifest/lock persistence-failure combinations, recovery diagnostics, preservation of prior lock unknown fields, foreign-directory link conflicts, unreadable/future import registries, waiting for refreshes and cancellation releasing the lease. The custom-agent unregister/retained-import restore test uses the same public service.

## Deliberate compatibility boundary

The user explicitly permitted appropriate historical incompatibility. Restore rejects external/plugin/unknown ownership and agent archives lacking their original home; it leaves manifests, archives and original sources untouched. Historical agent lock snapshots are ignored. Deterministic SSOT fallback and legacy metadata-ID mapping remain. Stored lock v3/archive v1/imports v1 fields and IPC result shapes do not change. These are documented operation-compatibility changes, not automatic data migrations.

## Checks run

- `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`: 397 passed, 3 existing ignored tests; no failures. This includes 335 library tests and 62 integration tests.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --features test-helpers -- -D warnings` and `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: passed.
- `bun run cli:typecheck`, `bun run cli:test` (131 tests across 13 files), `bun run cli:build`: passed.
- `bun run test` (478 tests across 52 files), `bun run typecheck`, `bun run lint`, `bun run format:check`: passed.
- `bunx oxfmt --check packages/cli/tests/archive.test.ts`, `git diff --check`, `openspec validate --all --strict`, `adrkit validate --all`: passed before closeout; OpenSpec and ADR validation are repeated after archiving.

## Remaining boundaries

Install/update/merge/import flows and public AppState fields remain outside this first wave. The CLI retains its existing operation/recovery implementation; shared scenarios enforce this change's protocol behavior without pretending the two runtimes now share an engine. Ordinary rollback is tested; there is no new crash/power-loss atomicity guarantee or recovery journal for skill files. External tools that ignore the lease can still race filesystem changes. Platform-specific packaging, Windows junction behavior and Linux UI were not exercised here.
