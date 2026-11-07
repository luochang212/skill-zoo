# Tasks

## 1. Characterize the lifecycle

- [x] 1.1 Reproduce same-name physical-identity and provenance problems through real Rust/CLI functions; retain shared scenario regressions.

## 2. Establish the service boundary

- [x] 2.1 Move archive workflows and their tests into a guarded service, leaving thin IPC commands; verify that per-item writes cannot be called without the private write context.
- [x] 2.2 Consolidate target resolution and store snapshots/recovery; verify roundtrip identity, ownership, legacy records and unchanged wire results.
- [x] 2.3 Exercise real failure paths, rollback diagnostics, refresh serialization, and lease release on cancellation; fix only reproduced defects within this lifecycle.

## 3. Cross-runtime and closeout

- [x] 3.1 Align CLI provenance behavior with the desktop, update shared fixtures/protocol documentation and run both sides' scenario tests.
- [x] 3.2 Run full suites and required gates, document before/after structure and remaining boundaries, sync specs and archive the change.
