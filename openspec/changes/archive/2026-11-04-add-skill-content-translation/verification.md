# Current verification scope

The final UI and credential follow-up changes were reviewed against the current source and specifications. Static review corrected stale split-button and credential tests, synchronized removed input focus styling, and fixed model-key query cache updates after replacement or clearing so an older read cannot restore the previous key. GitHub credential saves likewise cancel older token reads before updating their query cache.

Local checks completed for this snapshot:

- TypeScript: `./node_modules/.bin/tsc --noEmit` passed.
- Frontend lint and format: `bun run lint`, `bun run format:check` passed.
- Rust: `cargo check --offline --manifest-path src-tauri/Cargo.toml` passed; formatting applied with `cargo fmt`.
- Specifications: `openspec validate --all --strict` passed, 18 items, no warnings.
- ADR records: `adrkit validate --all` passed. ADR 1's local skill protocol is unchanged; no persistence migration or CLI fixture change is needed.
- Patch whitespace: `git diff --check` passed.

Per the user's instruction, this follow-up did not run test suites, browser/runtime interaction checks, external metadata requests, or model requests. Regression cases were updated but remain unexecuted. Earlier verification of the initial feature does not establish runtime verification of these later changes. The change remains active pending manual verification; it is not archived or released.
