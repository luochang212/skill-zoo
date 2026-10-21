# Verification

## Diagnosis and decision

Confirmed P2: API failure → ZIP README fallback → current-time disk cache → credential update → ordinary refetch returns old content without another network attempt. This affects recovery, not file integrity or credentials. A small local timestamp fix is worth making; no architectural refactor or download change is needed.

An isolated production-function probe reproduced the defect before implementation. The permanent `readme_recovery_test` invokes the real `get_repo_readme` command, with a temporary home and a subprocess-local mock HTTPS proxy. The parent test expects exactly two CONNECT attempts; fake credentials never leave the local subprocess/proxy test.

## Red → green

- Before the fix: `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml --test readme_recovery_test -- --nocapture` failed: **expected 2 requests, received 1**.
- After the fix: the same test passed, proving that the post-credential-change read retries the network.
- The ZIP is deleted after the first read: the second read still returns persisted fallback content while offline.
- A fresh API cache entry is then seeded and queried after another credential change: its content and timestamp are preserved, with no additional network request.

The regression exercises the failure/retry path, rather than a live authenticated GitHub success response. Existing GitHub consumer authentication tests cover header attachment. No real token or user cache was used.

## Compatibility boundary

Previously persisted entries have no provenance field, so old ZIP-derived fresh entries cannot be selectively distinguished from genuine API entries. Their existing force-refresh action or TTL expiry remains the recovery route. The fix prevents new ZIP fallbacks from renewing API freshness; it does not clear valid existing caches or introduce a cache migration.

## Validation

- Full backend suite: `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` — passed (279 passed, two existing performance tests ignored).
- Standard Clippy: `cargo clippy --features test-helpers --manifest-path src-tauri/Cargo.toml -- -D warnings` — passed.
- New regression target Clippy: the same command with `--test readme_recovery_test` — passed.
- Rust format check, `git diff --check`, `openspec validate --all --strict`, and `adrkit validate --all` — passed.
- An additional `--all-targets` Clippy run failed on 27 warnings in pre-existing unit tests (including `cmp_owned`, `cloned_ref_to_slice_refs`, and `unnecessary_get_then_check` in unchanged test code). Those unrelated lint cleanups are outside this fix; the standard gate and the new regression target both pass with warnings denied.
- Frontend checks were not rerun for this backend-only fix.
