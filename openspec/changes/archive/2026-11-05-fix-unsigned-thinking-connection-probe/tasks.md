# Tasks

- [x] Reproduce unsigned thinking decode failure with a local HTTP 200 fixture and confirm the user-triggered diagnostic matches.
- [x] Validate raw probe envelopes independently of SDK content decoding and remove diagnostics.
- [x] Run regressions, sync the main spec and archive with verification evidence.

Verification: the new regression failed before the fix with `Err("providerResponse")`; all 13 LLM service tests pass after the fix. `cargo fmt --check` and `adrkit validate --all` pass. The user-triggered pre-fix diagnostic confirmed `response_decode` and `unsignedThinking=true`; a post-fix live probe has not been run by the agent.
