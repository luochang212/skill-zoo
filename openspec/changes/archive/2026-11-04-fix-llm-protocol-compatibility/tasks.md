# Tasks

## 1. Anthropic routing and authentication

- [x] 1.1 Add HTTP regressions for gateway roots, existing v1 paths, probe/stream dual authentication and anonymous requests; reproduce failures, fix shared routing/auth, and verify the tests pass.

## 2. OpenAI protocols and safe failure handling

- [x] 2.1 Verify custom roots, modern Chat Completions budgets and reasoning/usage streaming, and compact Responses JSON with HTTP regression tests; preserve behavior already supported by genai.
- [x] 2.2 Reproduce provider SSE failures misclassified as network errors, fix typed error classification, and verify all three protocols redact errors and do not retry.

## 3. Integration checks

- [x] 3.1 Sync the provider main specification, run the backend suite, Rust format/Clippy, OpenSpec strict validation and ADR validation, and record results and live-endpoint limitations.

## Workflow follow-up

- Archive the verified change after implementation.
