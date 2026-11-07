# Tasks

## 1. Land the lifecycle write boundaries

- [x] 1.1 Merge duplicates into SSOT behind a guarded service entry with live verification, staging and complete prior-state recovery (`e24da33`), with integration tests for persistence failure, owner preservation, cancellation and nested link conflicts.
- [x] 1.2 External import behind the same guard order with pre-write ambiguity rejection and registry-snapshot rollback (`57aa665`), with tests for duplicate selection, cache-commit failure, pre-existing links and import-timestamp preservation.
- [x] 1.3 Unify repository browsing and installation on one candidate traversal with unchanged observable semantics and boundary tests (`57aa665`).

## 2. Sync the specs

- [x] 2.1 Add the `skill-merging` capability spec covering verification, commit ordering, recovery disclosure and writer coordination.
- [x] 2.2 Extend `local-protocol` with the external-import pre-write guards and snapshot-owned rollback.
- [x] 2.3 Record the discovery unification and its no-delta rationale in design.

## 3. Closeout

- [x] 3.1 Run full suites and gates (Rust 406/0, gate clippy, fmt, OpenSpec strict, ADR validation; frontend and CLI suites green under their own runners).
- [x] 3.2 Archive the change and sync main specs.
