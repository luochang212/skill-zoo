# Verification

- Frontend full suite: `bun run test` — 35 files / 229 tests passed before the final additional regression cases.
- Final affected frontend regression suite: 4 files / 33 tests passed, including failed/degraded/in-flight credential recovery, failed saves, no automatic retries, both-language diagnostics, README failures and update-manager recovery actions.
- Backend full suite: `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` — passed (two existing performance tests ignored).
- Final GitHub response classifier tests: both passed after retry timestamp validation adjustment.
- `bun run typecheck`, `bun run lint`, `bun run format:check`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `git diff --check` — passed.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --features test-helpers -- -D warnings` — passed.
- `openspec validate --all --strict` and `adrkit validate --all` — passed.

GitHub HTTP error cases were exercised against a local mock server; no real PAT, live GitHub quota exhaustion or packaged desktop manual session was used. Existing disk cache TTL/fallback implementations and local protocol schema are unchanged.
