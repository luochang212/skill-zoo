# Worth-fix verification

Assumption: a single-user local file manager with potentially concurrent desktop refreshes and a companion CLI. Findings are assessed against the current production functions, not file length. No new architecture decision is needed: these repairs implement existing ownership and protocol choices (ADR 1, 3, 4).

## Decisions

| Original finding | Truth and evidence | Probability / impact / cost / consequence if skipped | Decision |
| --- | --- | --- | --- |
| Desktop/CLI consistency rules diverge | Confirmed: real `runConsistency` tests reported an external import as both conflict and mismatch; a depth-21 file made one real hash unavailable but still produced `duplicate`. Both new tests failed before the fix. | Conditional on external imports or incomplete hashes; incorrect advice rather than automatic mutation; a small filter and all-member hash check; repeated misleading warnings if skipped. Medium/low severity. | Fix locally. Retain CLI's all-agent scan breadth and independence from desktop display preferences; do not expand this repair into settings interpretation. |
| Cache protections are only partially integrated | Partially confirmed: actual `upsert_cache_entry` on a cache destination occupied by a directory returned an error but retained the new entry in memory. The regression assertion failed before repair. Watcher/update paths lacked the full-rebuild refresh mutex by control-flow inspection. | Save failures and overlapping refreshes are conditional; stale or inconsistent derived state, not demonstrated source-file loss; reuse existing mutex and batch rollback; otherwise refresh/restart may self-heal, but failed saves remain misleading. Medium severity. | Fix the proven persistence divergence and align watcher/update refreshes with existing protections. No transaction framework or new storage protocol. |
| Single and concrete-root scans build different records | Confirmed: real nested `category/demo` with a legacy leaf-key lock yielded `repo_owner=None` from the single scan versus `Some("owner")` from the concrete scan; regression failed before repair. Invalid UTF-8 fallback and both agent/SSOT origins are covered by the retained test. | Legacy/nested or unreadable-text inputs; lost source metadata or a spurious naming mismatch; delete duplicate record construction and delegate; discrepancy persists across different refresh triggers if skipped. Low severity. | Fix through existing concrete-root modeling; retain directory resolution and symlink-only-home rejection. |
| New archive creation retains unreachable external branches | Confirmed structurally: all calls enter through an unconditional external-import rejection. A production `archive_skill_inner` test verifies the error, unchanged source, unchanged cache, and no app-state directory creation. | No current runtime defect from the dead branches; small deletion; continuing maintenance confusion if skipped. Hygiene only. | Delete only new-archive dead branches. Historical external restore paths are reachable from stored manifests and remain intact. |
| Large command/service files mean the architecture needs splitting | Mixed responsibilities are observable, but no independent failure or benefit from a whole-file move was established. The defects above have small local fixes. | No measured user impact from file size itself; broad movement has substantial review/regression cost; deferral does not block these repairs. | Do not restructure files or add layers. Retract treating concentration alone as evidence that restructuring is currently worth doing. |

## Production-path regression coverage

- CLI: `excludes external imports from duplicate and naming issues`, `does not call copies identical when one content hash is unavailable` call `runConsistency` against actual temporary skill trees. The depth limit is exercised rather than mocking a missing hash.
- Rust: `single_and_root_scans_agree_for_nested_skills` exercises the real scanners for agent and SSOT roots, legacy lock keys and invalid UTF-8.
- Rust: `cache_upsert_preserves_memory_and_disk_when_save_fails` causes a real filesystem rename failure and verifies the original in-memory record remains while the new record does not.
- Watcher: `incremental_refresh_waits_before_scanning_during_an_active_refresh` holds the actual refresh mutex and invokes the production incremental function; `incremental_refresh_preserves_the_batch_when_cache_persistence_fails` verifies a real two-root scan/save failure preserves the entire cache and source files.
- Archive: `archive_rejects_external_import_before_touching_files_or_stores` exercises the production archive workflow, beyond its validation helper.
- Existing batch helper tests verify one persist call and rollback. Existing installed-refresh tests verify waiting for an active refresh.

## Corrections and validation boundaries

The old audit did not reproduce the overlapping desktop-window race or an actual GitHub update followed by a cache failure. A live Tauri State/AppHandle and network update would be required to drive those complete UI/IPC paths. Instead, the watcher now accepts the existing AppState directly for production-path scheduling/failure tests, while the command wiring is inspected to ensure both update paths await the existing serialized refresh and record/return its error. This is structural validation plus tests of the production refresh components, not a claim of a reproduced end-to-end race.

Cache state is derived and can be rebuilt. No evidence establishes skill-file corruption, unauthorized access, or power-loss durability from these findings. No new threat surface, protocol fields, migrations, dependencies, or link-cleanup permissions are introduced. The local protocol fixtures therefore remain unchanged.

## Final checks

- `bun run test`: 52 files / 478 tests passed.
- `bun run cli:test`: 13 files / 126 tests passed.
- `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`: 384 tests passed across unit and integration suites; 3 existing ignored tests (two performance probes and a live catalog probe); doc tests passed with zero cases.
- After the last test-only adjustment, the nested-scan regression and both watcher incremental regressions passed again against the current source.
- `bun run typecheck`, `bun run cli:typecheck`, `bun run lint`, `bun run format:check`, Rust formatting and `cargo clippy --manifest-path src-tauri/Cargo.toml --features test-helpers -- -D warnings`: passed.
- `git diff --check`, `adrkit validate --all`, and strict validation of this OpenSpec change passed. Archival synchronized both main specs; the final `openspec validate --all --strict` passed all 18 specs. Main-spec diffs preserve the existing purpose and requirements and contain only the three added requirements.
- Production portions of the four changed modules decreased from 6,731 to 6,653 lines (78 fewer), excluding Rust test modules. Added lines outside those portions are regression tests and documentation.
- Not checked: website, cross-platform hardware, live desktop/GitHub update scenarios, and power-loss/crash injection. No skill source folders were changed by the repair; filesystem tests use temporary fixtures.
