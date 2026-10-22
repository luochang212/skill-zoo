# Tasks

## 1. Protocol contract (docs, fixtures, dual tests)

- [x] 1.1 Document `skillFolderHash` in `docs/local-protocol.md`: definition (SHA-256 over sorted `relative-path + 0x00 + bytes` of regular files, symlinks skipped and never followed, recursion depth cap), write points (install/update completion), unknown-baseline rule (missing or empty value = cannot judge), and the symlink-visibility caveat.
- [x] 1.2 Extend `fixtures/local-protocol/` with a lock entry carrying a realistic populated hash and keep the legacy empty-string case covered; verify `lock-v3-full.json` remains valid.
- [x] 1.3 Update Rust protocol tests and `packages/cli` protocol tests for the extended fixtures (desktop treats the value as a usable baseline; CLI reads and preserves it without interpreting it).

## 2. Backend: baseline computation and write points

- [x] 2.1 Implement the folder-content hash helper in `src-tauri/src/services/` with unit tests: determinism, path-rename sensitivity, symlink skipping, depth cap, unreadable-file error.
- [x] 2.2 Write the baseline in the remote-install completion path via `SkillLock::update`; remove the empty-string `skillFolderHash` write site.
- [x] 2.3 Write the refreshed baseline after a successful update content swap (including confirmed drift overwrites); confirm the failure/rollback path leaves the stored value untouched.

## 3. Backend: drift detection and update gating

- [x] 3.1 Compute drift in the update-check pipeline next to the `commitSha` comparison and expose the three-state verdict (up-to-date / update-available / update-available-and-drifted) on update items; treat missing baseline or hashing errors as "cannot judge".
- [x] 3.2 Add the force flag to the single-update and per-item batch update commands; without it, a drifted skill is refused with a distinct error; with it, the update applies and refreshes the baseline.
- [x] 3.3 Backend tests: unmodified skill updates directly; drifted skill refuses without the flag and applies with it; batch alignment skips drifted items; legacy empty-hash entry never blocks.

## 4. Frontend: update manager gating and summary

- [x] 4.1 Render the drifted state on update-manager items and add the overwrite confirmation for single updates, with EN/ZH strings.
- [x] 4.2 Exclude drifted items from batch auto-apply, list them in the completion summary as skipped, and wire the per-item "update anyway" action.
- [x] 4.3 Frontend tests for the drifted item states, the confirmation gate, and the batch summary path.

## 5. Verification

- [x] 5.1 Run `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` and `bun run test`; run `bun run lint` and `bun run format`.
- [x] 5.2 Verify the affected main specs (`skill-installation`, `local-protocol`) still match `openspec validate --all --strict` and sync any wording settled during implementation.
