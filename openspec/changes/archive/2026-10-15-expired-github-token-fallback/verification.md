# Verification

## Completeness / Correctness / Coherence

All three requirements in the delta have implementations and tests; the change stays inside the request builder, the runtime credential slot and the settings save path. There are no UI copy, protocol, or dependency changes.

| Requirement | Implementation evidence | Verification evidence |
| --- | --- | --- |
| Expired token falls back to anonymous quota | `config::GitHubCredentials` parses the persisted expiry; `github_token()` filters expired credentials before `github_get` builds Authorization; absent/unreadable expiry stays attached | New `expired_saved_token_falls_back_to_anonymous_requests` asserts future expiry attaches, a passed expiry omits the header, and absent/unparseable expiry keeps attaching; existing endpoint-shape test still passes with the credentials API |
| Verified token settings (atomic save) | `save_github_credentials` writes both keys through `persist_github_credentials` with one `settings.save()`, restores in-memory settings on failure, and refreshes the runtime slot only afterwards; `update_setting`'s token special case is removed | Rewritten tests cover trim, one-write persistence of token + expiry, unrelated-key preservation, expired save stopping authentication, blank input removing both keys, and failed saves leaving both persisted and runtime state unchanged |
| Token removal and startup | `lib.rs` loads `github_token` + `github_token_expires_at` into `set_github_credentials` at startup; blank saves remove both keys | Settings tests assert persisted keys and `config::github_token()` after save/remove; the frontend suite asserts clearing sends one blank save without verification |

## Empirical chain for the fixed defect

- GitHub returns `401 Bad credentials` for an invalid/expired bearer token and `200` anonymously (curl checked against `api.github.com/rate_limit` during review).
- A temporary repro calling the real `CliService::parse_repo_tree_response` with a 401 printed `TMP-REPRO: 401 maps to Ok(None) = true`, confirming 401 shares the "repository not found" branch; the repro was removed and the fixed scenario now lives as the flipped regression assertion above.

## Gates

- `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`: 209 passed, 0 failed (1 pre-existing ignored perf test; includes the new regression test).
- `cargo clippy --features test-helpers -- -D warnings`: exit 0. `cargo fmt -- --check`: exit 0.
- `bun run test`: 33 files, 201 tests passed.
- `bun run lint`: 0 warnings, 0 errors. `bun run format:check`: clean. `bun run typecheck`: exit 0. `bun run build`: exit 0.
- `openspec validate --all --strict`: 12 items passed before archive (11 main specs + this change); re-validated after sync and archive.

## Limits and trade-offs

No real expired PAT was available; expiry behavior is verified through the request builder and settings persistence rather than a live GitHub session. No native three-engine visual check; the row copy and expiry display themselves are unchanged by this change. Clock skew ahead of real time can skip a still-valid token. The skip is visible in the amber row and recoverable by saving again. Revoked tokens without expiry metadata are still attached and keep surfacing as repository-unavailable diagnostics; that mapping is unchanged and out of scope here.
