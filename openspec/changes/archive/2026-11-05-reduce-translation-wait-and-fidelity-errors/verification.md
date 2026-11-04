# Verification

- Frontend: `bun run test` — 44 files, 337 tests passed. `bun run typecheck`, `bun run lint`, `bun run format:check` passed. The final SkillContentPane configuration identity adds thinking without changing the hook state machine.
- Backend: `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` — full suite passed (295 library tests plus integration suites); existing performance probes remain ignored. `cargo clippy --features test-helpers --manifest-path src-tauri/Cargo.toml -- -D warnings` passed.
- Regression test first reproduced production rejection of intact reordered inline markers, then passed after grouping by source line. Missing/duplicate markers, cross-line/block moves, frontmatter and repair tests pass.
- SDK wire test confirms Anthropic Messages preserves the explicit disabled field, beyond checking the parameter mapping function.
- Old model configuration defaults thinking to false; explicit true persists. Cache keys and the frontend document configuration identity include thinking. Unknown endpoint/model combinations produce no extra parameters.
- Frontend verifies first-option placement, off default, confirmation/cancellation, late capability isolation, no visible capability status, and preservation of a saved choice if confirmed while capability lookup is pending.
- Replayed both historical failed medium-document first responses: both now restore directly with no repair. Two new direct DeepSeek Chat Completions requests with the new prompt and thinking disabled both completed and restored without repair; first content was about 1.47/0.87 seconds, total 3.39/2.98 seconds, 1,073 tokens each, no reasoning content. Raw checks are in docs/research/translation-benchmark/post-fix-checks.json. These are direct API plus production protection checks, not a claim of full desktop UI latency or live tests of every supported provider.
- No concurrent translation, JSON translation protocol, new translation lifecycle state, provider configuration rewrite or skill-file changes were introduced. Main specs synced; final OpenSpec and ADR validation recorded after sync.

## Limits

macOS WebView appearance and actual first rendered frame were not manually verified. Only DeepSeek received new live inference calls; other parameter mappings are documented and covered by local tests. Capability mapping is intentionally limited to confirmed endpoints/models; UI exposes only the disabled or enabled control, no explanatory state text. Inline reordering across separate source lines remains conservatively rejected.
