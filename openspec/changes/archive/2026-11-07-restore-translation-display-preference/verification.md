# Verification

- Red: default-off entry tests and A→B→A navigation failed against the old default-on hook (3 failures). Re-enabling after a cache miss also reproduced a stale loading-gate state before the final reset fix.
- The hook now keeps shared tasks/results and uses a per-view explicit selection gate for original-first behavior. Default entry does not mutate other views. Document/policy changes reset that gate and the cache loading marker.
- Focused hook, settings and detail-pane tests passed before the final extra edge-case coverage (76 tests). Final full frontend: `bun run test` — 48 files, 450 tests passed.
- Backend: `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` passed: 316 unit tests and 60 integration tests, with 2 pre-existing performance tests ignored; doc-tests completed with 0 tests. The new preference test verifies missing-field/default=false and round-trip persistence of true.
- Typecheck, lint, frontend/Rust format checks, strict OpenSpec validation, ADR validation, and diff whitespace checks passed after the final code changes.
- Both display modes, fresh QueryClient cache restoration when enabled, same-session return and A→B→A original-first navigation when disabled, background completion, manual result reuse, view isolation, late cache reads, toggling the setting, and the prior forced-streaming retranslation fix are covered.
- Reviewed ADR 1 and ADR 5: this preference is outside CLI local-protocol fixtures; intentional Unassigned copy is unchanged. No new dependency or migration was added.
- Existing uncommitted progress-color and retranslation changes were retained; the active retranslation delta was reconciled with the new display-policy wording. Archived records were not rewritten.
- No paid inference or manual desktop restart/visual check was performed. Restart behavior is tested with independent QueryClient instances and the cache API seam.
