# Tasks

## 1. Metadata identity and migration

- [x] 1.1 Implement stable key and conservative v0→v1 migration in Rust and CLI; verify shared metadata fixtures, conflicts, idempotence, unknown-field policy and future-version preservation.
- [x] 1.2 Document metadata protocol and explicit manual assignment/discard; verify CLI resolution and imports identity protection.

## 2. Lifecycle integration

- [x] 2.1 Apply stable keys to all desktop/CLI read/write lifecycle paths and strict source parsing; verify real scans across source changes, malformed sources and missing locks without cache evidence.
- [x] 2.2 Verify historical archive restore and both cross-runtime archive/restore directions preserve flags; preserve explicit merge OR behavior.
- [x] 2.3 Sync main local-protocol specs and verify docs and fixtures agree with production behavior.

## 3. Integration checks

- [x] 3.1 Pass full Rust, frontend, CLI tests, both typechecks, lint, cargo fmt and strict OpenSpec validation; write /tmp/codex-a1-report.md with evidence and boundaries.
