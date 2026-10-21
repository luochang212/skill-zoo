# Verification

- Frontend full suite after review fixes: `bun run test` — 35 files / 234 tests passed.
- Final affected frontend regression suite: 4 files / 33 tests passed, including failed/degraded/in-flight credential recovery, failed saves, no automatic retries, both-language diagnostics, README failures and update-manager recovery actions.
- Backend full suite after review fixes: `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` — passed (225 unit tests plus integration suites; two existing performance tests ignored).
- Final GitHub response classifier tests: both passed after retry timestamp validation adjustment.
- `bun run typecheck`, `bun run lint`, `bun run format:check`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `git diff --check` — passed.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --features test-helpers -- -D warnings` — passed.
- `openspec validate --all --strict` and `adrkit validate --all` — passed.

GitHub HTTP error cases were exercised against a local mock server; no real PAT, live GitHub quota exhaustion or packaged desktop manual session was used. Existing disk cache TTL/fallback implementations and local protocol schema are unchanged.

## Review follow-ups

- Fixed the living-spec contradiction: the “Public-only setup and recovery guidance” requirement is now a MODIFIED delta entry and the main spec matches the behavior (token setup only for invalid credentials and anonymous quota exhaustion).
- Confirmed README 404 still maps to `repoNotFound`; the repository panel suppresses it for README, so the only consumer shows absence correctly. Documented as a deliberate trade-off in the design instead of adding a new error code.
- Confirmed `preview_skill_md` reads a cached ZIP, not a repository API, so it is outside the no-retry rule.
- Confirmed by regression test that unmapped structured error codes preserve the backend message; previously the same error rendered as “Invalid request: …” when passed as an object and as the generic message when passed as a JSON string.
- Removed the unused RFC 2822 `Retry-After` branch, named GitHub's anonymous quota constant, and replaced repeated `CommandError` serialization with `CommandError::to_json()`.
- Reset the README test mock in `afterEach` so a failing assertion cannot leak state into later tests.
