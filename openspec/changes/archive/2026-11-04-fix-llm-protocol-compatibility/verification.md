# Verification

## Comparison

Compared the local ZCode checkout at `a60ba6a7e5a06742270ca605f5d2cc2766afa7e1`:

- `apps/zcode-cli/packages/adapters/src/model/model-execution.ts`: Anthropic root normalization and dual authentication; OpenAI factories preserve custom API roots.
- `apps/zcode-cli/packages/adapters/tests/connectivity-probe-wire.test.ts`: protocol-specific output fields and explicit model/route selection.
- `apps/zcode-cli/packages/adapters/src/model/openai-responses-json-compat.ts`: repairs missing message IDs/annotations for Vercel AI SDK. Our compact-JSON regression passes through genai without a repair wrapper.
- `apps/zcode-cli/packages/core/src/runtime/methods/workspace-generate-text.ts`: current probe budget is 1; the 512-token document is a pending task rather than shipped behavior. Existing Skill Zoo budgets remain 1/1/16.

Primary references checked: [Anthropic authentication](https://platform.claude.com/docs/en/manage-claude/authentication), [Messages endpoint](https://platform.claude.com/docs/en/api/typescript/messages/create), and [OpenAI Chat API](https://developers.openai.com/api/reference/resources/chat). Dual headers are a compatibility choice drawn from ZCode; the official authentication reference also accepts Bearer and retains the legacy x-api-key header.

## Reproduction and regression results

- Before the fix, `cargo test --lib --features test-helpers --manifest-path src-tauri/Cargo.toml services::llm::tests:: -- --nocapture` failed the Anthropic probe, root normalization, and streaming authentication assertions: 4 passed, 3 failed.
- Before the classifier fix, the focused `provider_stream_errors_are_safe_response_errors_without_retry` test returned `network` for an HTTP 200 Chat error stream where `providerResponse` was required.
- After the initial fix, all 9 colocated LLM tests passed. Final coverage additionally exercises repeated Anthropic trailing slashes and anonymous probe/stream requests for all three protocols under HTTP 401, 403, 429, and 500.
- Chat tests cover custom API prefixes, modern-model `max_completion_tokens`, ordinary `max_tokens`, reasoning chunks, usage-only final chunks, and truncated output. Responses tests cover custom prefixes, `max_output_tokens`, `store:false`, compact JSON, and streaming completion/truncation.
- Provider error regressions exercise all three SSE protocols plus malformed Chat/Messages events, require exact safe error categories, and count HTTP requests to catch unintended retries.

## Final checks

- `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`: passed, including all 9 LLM tests, 273 unit tests and all integration tests; two existing performance tests remain ignored by default.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --features test-helpers -- -D warnings`: passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: passed.
- `openspec validate --all --strict`: 17 items passed, no failures before archive.
- `adrkit validate --all`: passed.
- `git diff --check`: passed.

## Scope and limitations

No frontend, credentials, persisted schema, dependencies, or local skill protocol changed. No real provider credentials were used; the user's live endpoint and desktop UI were not exercised. Frontend/browser tests were not run for this Rust-only change.
