# 2026-10-24 Full-Repo Review Triage

A five-track review (Rust backend, frontend, CLI, cross-layer consistency, docs/language) produced the findings below. Each finding was re-verified against real code before a verdict. "坐实" means reproduced by executing a test against the production code path; "结构核实" means verified by source reading with the reasoning recorded; "证伪" means the claim did not survive verification.

Verification boundaries on this host: no Windows runtime (junction/hash behavior verified from libuv v1.49.2 and Rust sources, not executed); site deps not installed (`astro check` deferred to CI; `ui.ts` verified at transpile level).

## Fixed in this change

| Finding | Verdict | Fix |
| --- | --- | --- |
| Scans delete dangling symlinks in any agent dir without ownership check (`services/skill.rs` scan path) | 坐实（回归测试红→绿：foreign dangling link was deleted） | Only remove links whose lexical target is inside SSOT (`is_app_owned_link`); foreign links survive |
| `make_skill_id` panics when an SSOT entry is a symlink; "Update all" hangs forever | 坐实（测试捕获 panic `non-ssot skill must have an agent_id`） | `scan_single_skill` returns a NotFound error for unattributable directories; callers already treat scan failures as skips |
| WUI: every API request binds the lease independently; the frontend's parallel inspect+content always loses one | 坐实（live probe 5/5 failed; regression test red→green） | Per-server lease gate queues acquisitions in-process; cross-process exclusion unchanged |
| Exit guard only wrapped `update_all_skills` | 坐实 | `install_skills`, `update_skill`, `archive_skills`, `restore_archived_skills` all take the guard; dialog copy generalized (en/zh) |
| Cache `compute_content_hash` read whole files into memory, unbounded recursion | 结构核实 | Streams 8 KB chunks; depth cap 20 mirrors install/baseline caps; digest unchanged (pinned by vector) |
| CLI/desktop cache `contentHash` could diverge (path separator normalization; whole-string vs component-wise sort — the sort difference also affects macOS) | 坐实（vector digest differs pre-fix） | CLI hashes the raw relative path and sorts component-wise (code-point order = Rust `PathBuf` ordering); new cross-runtime vector fixture `fixtures/local-protocol/content-hash-vector/` asserted by both runtimes |
| CLI `archiveId` used 8 hex chars; desktop uses 16 | 坐实（`hash[..8]` operates on digest bytes） | CLI matches 16 |
| Desktop-tolerated empty state files crash every CLI command; `null` lock crashed with TypeError | 坐实（probe） | `readJson` treats empty/whitespace as absent; `readStateFile` rejects non-object documents with a clean error |
| CLI journal recovery restored `settings.json` with 0644 (token-bearing) | 结构核实 | Temp file created with 0o600 |
| CLI `writeTextAtomic` had no fsync | 结构核实 | fsync before rename, matching the desktop's atomic write |
| Re-import via a different path spelling created duplicate import entries and reset `importedAt` | 坐实（regression test） | Dedupe by canonical path; preserve `importedAt` on re-import |
| `rollbackRestore` used unguarded recursive remove on link paths | 结构核实 | Uses the `removeAgentLink` guard |
| WUI: invalid JSON body → 500; `..foo` file falsely 403 | 结构核实 | CliError 400; exact `..`-segment escape check |
| Tray navigation swallowed by an open skill detail (stuck view, hidden tabs) | 坐实（code path confirmed） | Tray navigation closes overlays first; unsaved drafts go through the existing confirm dialog, then the deferred navigation applies |
| Single-skill update success toast hardcoded English | 坐实 | `skills.updateSingleSuccess` key in both dictionaries |
| GitHub token failures toasted as `Invalid request: githubTokenVerificationFailed` | 坐实 | `formatApiError` maps the synthetic keys to the existing translated strings |
| `["skills","updateCheck"]` not invalidated by install/remove | 坐实 | Added to both invalidation entries |
| Update Manager reset user selection on background refetch | 坐实 | Re-seeds only when the candidate set changes, not on array identity |
| `useRecentlyViewed` trusted localStorage shape (ErrorBoundary risk) | 坐实 | Shape-guarded filter |
| Hardcoded user-facing English (column headers, "Repository", "Label Settings", ErrorBoundary, sr-only Close, aria-labels) and the sole untranslated zh string (`sidebar.unassigned`) | 坐实 | i18n keys added in both languages; components switched to `t()` |
| `docs/local-protocol.md` missing `plugins_discovery_enabled` (0.3.58 shipped it) | 坐实 | Documented under the settings section; external-import scan wording tightened should→must; content-hash vector registered in Fixture Maintenance |
| `BRANCHES.md` stale (wrong last release, nonexistent tag/branches) | 坐实（git tag/branch checked） | Corrected to v0.3.58 and actual refs |
| AGENTS.md local-visibility section contradicted code for external imports and omitted plugin skills | 坐实 | Clarified that external imports follow the non-SSOT switch in the Local list while remaining manageable in Settings; added the plugin-exclusion bullet |
| README_zh dropped OpenClaw; heading/wording drift | 坐实 | Fixed; site copy: removed the 800ms claim (constant absent from code), "offline"→"local-first", ZH calque fix |

## Refuted (no fix)

- **CLI cannot detect Windows junctions** (`isSymlinkOrJunction` lstat-based): libuv `fs__stat_handle` marks every reparse point — junctions/mount points included — as `S_IFLNK` under `lstat` (libuv v1.49.2 `src/win/fs.c`, comment: "symlinks and mount points, both of which are treated as POSIX symlinks"). Node's `lstat` therefore reports junctions as symlinks. All 20 CLI link checks use `lstat`; the one `readdir(withFileTypes)` use is a pre-filter with an `lstat` re-check behind it.
- **CLI accepts `C:foo`/`\foo` as Windows `skillsDir`**: the existing root regex (`^(?:[A-Za-z]:|\\\\)` on `path.parse().root`) rejects drive-relative and rootless-backslash paths, matching Rust `is_absolute()`.

## Queued (real, but needs its own design change — do not drive-by)

1. **Crash-window recovery for updates and archives**: `.name.backup.NNN`/`.install.NNN` orphans have no startup sweep; archive commits the manifest before the physical move and is outside the journal; the CLI has no SIGINT rollback. Needs a recovery-semantics design (OpenSpec change; the exit-guard widening shipped here shrinks the windows).
2. **Custom-agent error mapping is string-coupled to backend English copy** (CustomAgentEditor.tsx): needs structured error codes, a protocol-adjacent change.
3. **CSP grants the renderer GitHub hosts; unused `opener:allow-open-path` capability**: tightening contradicts nothing in code today (no fetch/XHR in `src/`), but CSP/capability changes need runtime verification in the packaged app, which this host cannot run.
4. **Watcher incremental refresh not serialized against rebuilds** (self-healing race); **second instance fails startup without single-instance UX**; **`get_repo_skills` triggers a full rebuild per browse** (perf); **lock RMW at two desktop sites without the lease** (no second writer exists today).
5. Minor polish: unbounded `read_skill_text` reads, merge-duplicate link failures eprintln-only, CLI lease held during interactive confirmation, commander errors bypassing the JSON envelope, doctor exit-code documentation, `rebuildCache` narrowing plugin entries, ConfigureDialog per-switch pending indicator, companion-dialog Esc during row edit, BannerCarousel `src={undefined}` fallback, dead `setSkillIsMine` API surface, CHANGELOG's already-released 0.3.58 section left untouched.

## Verification evidence

- New regression tests: `src-tauri/src/services/skill.rs` (dangling-link ownership, symlinked SSOT scan, hash vector), `packages/cli/tests/wui.test.ts` (concurrent lease), `tests/state-files.test.ts` (empty/null state files), `tests/imports.test.ts` (canonical re-import), `tests/scan.test.ts` (hash vector).
- Suites: cargo `--features test-helpers` all binaries ok; frontend 255/255; CLI 123/123; `bun run lint` 0/0; `openspec validate --all --strict` 13/13.

## Worth-fix follow-up: uncommitted-change review

All four follow-up findings merit local fixes; no refactor or new architectural decision is needed. ADR 1 remains authoritative: the CLI follows desktop-owned semantics.

| Finding | Verification and impact | Decision / cost |
| --- | --- | --- |
| Depth cap differs between runtimes | Confirmed: the new CLI regression test returned a digest with an empty directory at depth 21 while desktop rejects that tree. This is an uncommon but real shared-cache discrepancy; no data loss was demonstrated. | Match desktop's root=0 / maximum depth=20 semantics and reject the entire hash, including for empty over-limit directories. Small recursive-return change; boundary tests in both runtimes. |
| Single pinned digest assumes Unix paths | Partially confirmed: separator-level reproduction yields Windows digest `2dfecf360fc626fd799cdae4ea9496f66c52ae87e6a54a8d12fce47420d53afb`, versus Unix `79920dea3ad218944061426e9d0297aec842aea007e5f9fb499660931685eb51`. Windows native execution is unavailable, so an actual Windows test failure is inferred, not observed. | Keep the existing desktop raw-path algorithm; pin platform-specific expectations in the shared fixture and select them in both tests. Test-only correction, no production hash migration. |
| Update success toast uses missing translation key | Confirmed by invoking the real mutation hook: both language cases failed with the raw key before the fix and passed afterward. Every successful single-skill update is affected. | Correct the lookup to `settings.maintenance.updateSingleSuccess`; retain en/zh mutation regression cases. Low cost, visible benefit. |
| Import preview returns a different ID from execution | Confirmed by the production import function: existing source imported through a symlinked parent yields a new preview ID but reuses the existing ID during execution. Preview is misleading; no destructive filesystem effect was demonstrated. Regression assertion failed before correction. | Canonicalize the dry-run map lookup too. Re-import test checks preview identity and that preview leaves the import registry unchanged. Very small local fix. |

Verification: frontend 257 tests and CLI 124 tests pass; Rust content-hash tests cover the pinned vector and depth boundary. Both TypeScript checks, frontend lint/format check, `git diff --check`, and OpenSpec strict validation pass. Windows-native verification remains unavailable. `adrkit` is not installed, so ADR 1 was read directly; Rust format checking remains unavailable because this toolchain lacks `rustfmt`.

## Pre-commit follow-up

- A default-feature build exposed one additional test-only regression: the unit hash-vector test called a helper gated behind `test-helpers`. `cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run` failed with E0599. The test now calls the existing private hash function directly, and the unused public helper is removed; the same default-feature compile passes. Production behavior is unchanged.
- Installed the missing Rust `clippy` and `rustfmt` components; Rust format checking now passes. ADR validation passes via `bunx --package adr-kit adrkit validate --all`.
- Installed the website's locked dependencies with `npm --prefix site ci`; `npm --prefix site run check` reports zero errors/warnings and the independent static production build passes. Windows-native and packaged desktop interaction checks remain outside this host's verification.
