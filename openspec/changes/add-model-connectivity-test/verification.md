# Verification

- `bun run test --maxWorkers=1`: 41 files, 304 tests passed. The default concurrent run timed out under local load; the complete serial rerun passed without changing test timeouts.
- `bun run lint`, `bun run format:check`, `bun run typecheck`, `git diff --check`: passed.
- `cargo test --lib -j 1 --features test-helpers --manifest-path src-tauri/Cargo.toml services::llm::tests -- --nocapture`: 6 passed, including existing streaming protocol behavior and minimal-request tests.
- `cargo test --lib -j 1 --features test-helpers --manifest-path src-tauri/Cargo.toml connection_`: 4 passed, covering three protocols, error classification, the real 15-second deadline and read-only draft credential resolution. These overlap the service tests above.
- `cargo clippy --features test-helpers --manifest-path src-tauri/Cargo.toml --lib -- -D warnings`, `cargo fmt --check --manifest-path src-tauri/Cargo.toml`: passed.
- `openspec validate --all --strict`: 18 passed. `adrkit validate --all`: passed.
- Main provider specification synchronized; no local-protocol document or fixture changes. No new dependencies or persistence schema changes.
- Network tests used local mock servers; no paid real-provider request was executed during verification.

## Subsequent settings and credential follow-up

The checks above describe the initial connectivity implementation. Later settings and credential UI changes received static source/spec review, TypeScript, lint/format, Rust offline `cargo check`, OpenSpec strict and ADR validation. The later snapshot did not rerun test suites or make external/model requests, per the user's instruction. Current follow-up evidence and limitations are recorded in `../add-skill-content-translation/verification.md`; the earlier test results must not be treated as verification of subsequent edits.
