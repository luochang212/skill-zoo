# Implementation verification

## Implemented behavior

- Settings uses the existing agent manager for add/edit/removal. Custom actions work in visible, hidden and searched rows. One dialog hosts the editor, path-change review and removal review. Form and review content scroll independently of fixed action bars.
- Name/path validation, native Rust directory selection, explicit directory creation consent, dirty-form discard, IME-safe Enter, duplicate-submit protection and en/zh messages are implemented. Failed saves retain the draft; unsupported usage tracking is explicit and Common Commands remains global.
- Custom registrations have stable UUID identities and absolute paths. Runtime configuration uses immutable snapshots; Rust scans pin a snapshot and CLI commands reuse one merged registry. Shared management consumers enumerate that registry rather than static built-ins.
- Native source files stay in place during registration changes. Departing real skills and archived source references become external imports using their existing skill IDs, preserving metadata and other-agent links. Existing external imports retain precedence, including directory aliases.
- Registration checks real directory identity, overlap with agent roots/SSOT/app state, case aliases and symlinks. Missing-directory rollback removes only directories actually created by the operation.
- Registry, settings and import changes use a recoverable before/after journal. Post-commit cleanup failure does not roll back removal. Rust and CLI use the same crash-released local lease; its port range avoids this machine's automatic ephemeral-client range.
- Visibility/order use current registered IDs, retain preferences missing from stale dialogs and enforce the existing cap/minimum rules. New registrations at the cap remain hidden.
- Watch roots reconcile without restart, retained external sources stay watched, and recreated agent directories attach monitoring. Lifecycle events invalidate configurations, installed/link/archive/import state and remote candidate conflict queries.
- Archive/restore preserves recorded entity destinations, skips unavailable agent links with a status and supports restored sources after removal. Native entities are excluded from link removal while archiving.

## Validation evidence

Completed validation runs:

- Frontend full suite: 29 files / 164 tests passed with `--maxWorkers=1`; focused editor and settings tests also passed (12 tests).
- CLI full suite: 12 files / 106 tests passed with `--maxWorkers=1`; focused custom-agent production-path tests also passed.
- Rust full suite: 222 tests passed (178 unit tests plus 44 integration tests), with two explicitly ignored performance checks executed separately. Real Rust/CLI lease interoperability passed. Clippy with `-D warnings` passed.
- `bun run typecheck`, `bun run cli:typecheck`, lint, format checks and `git diff --check` passed on the checked revisions.
- `openspec validate --all --strict`: 11 items passed after syncing the three affected main specs.

Earlier concurrent builds caused test timeouts; serial reruns passed. A real lease reacquisition failure prompted moving the lease below the host's 49152–65535 automatic client-port range. Neither a timeout nor that failure is counted as a passing check.

## Parity matrix

| Surface | Implementation / evidence |
| --- | --- |
| Settings | Editor tests cover missing-directory consent, failure retention, path review, removal cancellation, picker cancellation, IME/focus, dirty forms and query invalidation; existing manager tests cover ordering and visibility. |
| Local/detail/metadata | Shared registry enumeration; production lifecycle tests preserve nested native sources, stars and other-agent links across rename/removal. Detail/file APIs retain the existing managed-skill boundary. |
| Install/update | Shared selected-target directory resolution and preflight; all registry IDs use the existing SSOT installer/link/update paths. The operation lease pins target identity during preparation and writes. |
| Configure/drag/batch | Existing agent-driven UI and backend target paths now consume merged registrations; existing configure, install and unlink tests continue to run. |
| Scope/consistency | Existing origin/visible/selected scope rules operate over dynamic IDs; external ownership wins during scans. Rust and CLI tests cover imported/native directory overlap. |
| Archive/restore | Rust production archive → unregister → restore test; CLI native archive/restore followed by desktop-protocol removal; existing rollback/conflict suites. |
| Watch/cache | Root/event classification tests cover registered roots becoming retained external roots; lifecycle reconciliation rebuilds cache and watchers. |
| CLI/diagnostics | Shared current/minimal/invalid/future registry fixtures; custom selection, paths, scan, imports, diagnostics and archive enumeration. WUI requests also acquire a fresh registry scope. |
| Usage/Common Commands | Usage capability derives from actual collectors; current collector tests remain, custom editor reports unsupported formats, global commands are unaffected. |

## Frontend review

Artifacts under `evidence/ui/` cover 800×600 and 1280×800, en/zh, light/dark, 200% text scaling, the manager, editor and removal confirmation. They render the real components with mocked IPC; they do not prove the native OS folder dialog. Browser runs reported no page errors. Keyboard focus on the removal review moves from Cancel to Remove Agent, and the accessibility tree exposes the named confirmation group.

The browser review found an actual click/layout issue: blur-triggered preview content moved the action buttons. Fixed action bars and independently scrollable content resolve it; refreshed screenshots show the final layout.

Windows junction/case behavior and Safari 16.4 native runtime were not executed on this macOS host. Native Windows fixture paths and platform-specific guards are present. The implementation uses the existing Safari-compatible component/API surface and does not raise the browser floor. Accessibility-tree inspection was performed; a live VoiceOver session was not run.

## Performance evidence

Baseline: `0894795`, before implementation. Host: macOS / Apple A18 Pro. Measurements use temporary fixtures, production scan/path functions and warm repeated runs; median and empirical p95 are recorded in `evidence/`. Shared-machine contention makes the tail timings noisy, so these figures are comparison evidence rather than latency guarantees.

| Zero-custom case | Baseline median | Implementation median |
| --- | ---: | ---: |
| CLI scan, 100 skills | 153.98 ms | 48.71 ms |
| CLI scan, 1,000 skills | 1,922.60 ms | 997.74 ms |
| Rust batch scan, 100 skills | 248.16 ms | 136.65 ms |
| Rust batch scan, 1,000 skills | 1,774.22 ms | 1,124.33 ms |
| Rust 10,000 path lookups, 1,000-skill fixture | 4.82 ms | 6.56 ms |

After sharing one lock-metadata read per batch/full scan, optimized zero-custom Rust batch medians were 38.11 ms (100 skills) and 261.64 ms (1,000 skills), versus interleaved baseline medians of 95.80 ms and 1,065.53 ms. Lookup medians were 9.24 ms and 4.57 ms per 10,000 calls, within the 5 ms increase budget. The zero-custom gate passes. Earlier noisy and pre-optimization results are retained rather than discarded. CLI scans stopped performing redundant native-root realpath calls per skill/agent pair. Custom-root scaling at 0/5/20 roots and 100/1,000 total skills is recorded separately for empty and populated custom roots. Lifecycle timings cover rename and path changes: the 1,000-skill path-change medians were 263.82 ms (5 roots) and 232.26 ms (20 roots).

Registry allocation/read behavior is structurally verified: one merged CLI snapshot per command, reused by reference; one Rust list build per publication, with Arc clones during lookup. Path-result allocations remain. These are code/test observations, not allocator telemetry. Rust scaling measurements include one-skill incremental scans. An interleaved baseline/current comparison exposed noise and a slower aggregate 1,000-skill batch; this led to sharing one lock-metadata read per batch and full scan. The final optimized zero-custom measurement passes the budget; the refreshed full scaling matrix is in `evidence/rust-performance.log` (1,000 skills / 20 populated roots: median batch 206.67 ms, one-skill incremental 0.82 ms).

## Remaining verification

Task 5.4 remains open for the complete manual Escape/return-focus and screen-reader pass. Component tests and browser Tab/accessibility-tree checks passed; do not present those as a live VoiceOver verification.

## Open implementation decision

Future shipped built-ins can collide with an already valid custom registration's label or root. The original plan did not define reconciliation; its strict built-in label validation would reject such an upgraded registry. User clarification is pending between preserving the custom registration and suppressing the conflicting new built-in, or migrating to the built-in while retaining old-ID compatibility. Do not claim the entire change complete or archive it before that policy is resolved and tested.

## Official-support upgrade reconciliation (2026-10-11)

The user approved preserving custom IDs and suppressing only directory-overlapping built-ins; equal names at disjoint roots coexist. This supersedes the earlier label-collision choice and removes the editor's generic management/Common Commands/unsupported-statistics paragraph at the user's request. Tool-specific capability flags and supported-only statistics selection remain unchanged.

A production CLI parser reproduction previously rejected a valid custom `Codex` at a disjoint root with `Invalid or duplicate agent name`. Both registry readers now validate names independently of shipped labels. The shared `agents-v1-builtin-collision.json` exercises overlapping Codex and disjoint same-name Gemini. Actual Rust/CLI readers preserve original registry bytes, UUID/path identity and command snapshots; only the custom endpoint scans/accepts writes at the overlapping root. Missing equal/nested/ancestor roots and symlink ancestors are covered on both surfaces; a macOS case-alias/missing-leaf test passed on this host. Native Windows runtime verification remains unavailable.

Production lifecycle tests exercise changing the custom Codex root: the built-in returns, the active visibility cap stays at seven, retained files keep external ownership and original metadata IDs even during incremental refresh. The archive→unregister→reactivate-built-in→restore test preserves original content, destination and star metadata. Dormant shipped visibility/order preferences survive ordinary preference saves while remaining outside active enumeration. New import authoring still rejects active roots; existing import references take precedence during scanning.

Frontend full suite: 165 passed. CLI full suite: 109 passed. Rust final full suite: 228 passed (184 unit + 44 integration), two performance tests remain ignored by default. Rust clippy with `-D warnings`, frontend/CLI typecheck, lint, format checks and strict OpenSpec validation passed. Logs: `evidence/upgrade-rust-tests.log`, `upgrade-clippy.log`, `upgrade-performance.log`.

The zero-custom production benchmark was explicitly rerun after adding incremental external-import precedence: median batch100=23.40ms, batch1000=225.35ms, incremental≈0.85–0.97ms, lookup10k≈5.48–5.67ms. These remain within the recorded baseline budget; registry reconciliation is not performed per skill/path lookup.

The real manager/editor components were rendered at 800×600 in Chrome with injected registration data: `ui/upgrade-overlap-800-zh-light.png` and `ui/add-after-copy-removal-800-zh-light.png`. The suppressed row is read-only, describes the conflicting custom registration and full root, is outside visibility/cap, and exposes no switch. Browser reported no page errors; the removed editor copy is absent. These screenshots do not simulate an actual desktop update or native picker. Live desktop interaction review remains user-owned and unconfirmed; task 5.4 stays open.

## Review fixes (2026-10-11)

An independent review of the branch landed three corrections; deferred items and verification boundaries are recorded with them.

- Startup no longer aborts when `agents.json` is unreadable (corrupt, hand-edited, or missing `version`): after lease-guarded recovery the desktop boots with built-in agents and logs the parse error. Saves still refuse to overwrite the broken file (`AgentRegistry::save_to` re-reads), and later registry mutations surface the parse error when the user acts. Lease acquisition stays fail-closed per design — it performs journal recovery and its port range sits below the automatic ephemeral-client range. Verification is structural (the change lives in the Tauri setup closure) plus the existing `absent_is_empty_but_invalid_is_never_overwritten` persistence test.
- The visible-agent cap has one spelling now: `config::MAX_VISIBLE_AGENTS` replaces the private `settings.rs` constant and the two inline `< 7` literals in `agents.rs`. The differing policies are unchanged and documented at the const: preference saves guard growth past the cap, registration checks it directly.
- Unreadable directories no longer block agent removal, path changes or previews. `real_skills` and the preview's owned-link count skip them, matching `services::skill::collect_files_recursive` and the protocol's best-effort link cleanup. Red→green regression test: `unreadable_subdirectory_skips_instead_of_blocking_removal` (Unix `chmod 000`; passes trivially when run as root).

Deferred with reasoning:

- Holding the mutation lease across install/update downloads blocks unrelated settings saves and link toggles for the download duration. `CliService::add_skills` bundles download, extraction and registration writes, so narrowing the lease requires splitting that service; queued. The contention failure is a retryable command error, not data loss.
- `InstalledSkills.test.tsx` "shows SSOT, visible-agent entity…" failed intermittently (3/36 branch runs, 0/8 on main — not statistically separable). Every dependency of that test is mocked and unchanged by this branch and the component is untouched, so it is treated as an environment-level flake, not a regression. No fix landed; rerun if CI reports it.

The review also observed a discarded, never-staged ~224-line test expansion of `commands/agents.rs` that did not compile (`AgentLease` lacked `Debug` for `unwrap_err` on the commit tuple). Its intended scenarios are already covered by `rename_and_removal_preserve_identity_files_metadata_and_other_links`, so it was not recreated.

Validation for these fixes: Rust full suite 229 passed (185 unit including the new test, plus 44 integration), clippy `-D warnings`, `cargo fmt --check`, `oxlint`, `oxfmt --check`, and the frontend suite (29 files / 165 tests) all passed.

### Editor UX refinements (same session, product discussion)

The Skills directory field now precedes the name, and an untouched name auto-fills from the directory (last path segment, skipping a conventional `skills` leaf and leading dots). Once the user edits the name, later directory changes never overwrite it; editing an existing agent starts frozen on its current label. The duplicated path echo under the directory input appears only when the resolved path differs from the typed input (trailing-slash-insensitive), so identical resolutions render nothing. In the manager list, the per-row edit action moved to a leading slot that every row renders, keeping the open/switch columns aligned across built-in and custom rows; built-in rows fill the slot with an inert placeholder. Validation and focus follow the new field order — adding focuses the directory while editing focuses the label, so a stray keystroke cannot dirty a registered path. Covered by `suggestName` rule cases, autofill-follows-then-freezes, echo-shown-only-on-difference, edit-slot DOM-order/placeholder assertions, and the updated empty-submit focus test; the full frontend suite (29 files / 173 tests), `tsc --noEmit`, lint and format checks passed after these changes.
