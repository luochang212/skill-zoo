# Tasks

- [x] Capture the original timeout and a successful low-effort request; preserve the input-size limitation.
- [x] Add fixed-thinking request options and typed control capability; remove temporary diagnostics.
- [x] Update the existing switch and stale-query regressions.
- [x] Run backend/frontend checks, sync main specs and archive with evidence.

Verification: the new parameter regression failed before the fix (`None` versus explicit low). After the fix, all 375 frontend tests, 17 LLM service tests and 7 translation command tests pass. Typecheck, lint, format and Rust Clippy pass. The local HTTP fixture asserts the SDK sends `reasoning_effort=low`; fixed-state and stale-capability UI regressions pass. The successful live experiment used an 8,826-byte input; a like-for-like rerun of the earlier 20,036-byte input remains unverified. No extra live inference was initiated by the agent.
