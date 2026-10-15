## 1. Implement

- [x] 1.1 Add Rust/CLI pure resolver and real inventory with shared directory fixtures.
- [x] 1.2 Switch scans, watcher, Discover and editing/deletion/archive consumers.
- [x] 1.3 Split update directory/key, physical Check/checked identity and write-time revalidation.
- [x] 1.4 Add restore preflight and precise rollback.

## 2. Verify

- [x] 2.1 Exercise shared real layouts, ambiguity and lifecycle/update barriers on both surfaces.
- [x] 2.2 Synchronize protocol/main specs and pass all requested gates; record evidence.

## Verification evidence

- Rust `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`: lib 252 passed and all integration suites pass, 0 failed (2 pre-existing ignored); includes the shared layout fixture, ambiguity matrix, lifecycle and barrier tests.
- `bun run test`: 33 files / 211 passed. `bun run cli:test`: 14 files / 138 passed.
- `bun run typecheck`, `bun run cli:typecheck`, `bun run lint`, `cargo fmt --check`, `bun run format:check`, `git diff --check` and `openspec validate --all --strict` (17 items) all pass.
- Implementation started in an autonomous session that stopped at its usage limit; the one remaining compile error (an integration test calling a crate-private link helper) was fixed by making the existing `create_link_to_target_for_test` feature-gated `pub`, after which every gate above was re-run to completion.
- Not included: C1 provenance reconstruction, Windows/Linux runtime execution, and any storage migration.
