# Tasks

## 1. CLI consistency

- [x] 1.1 Reproduce external-import and incomplete-hash misclassification using runConsistency; fix and retain passing regression tests, clarify CLI README.

## 2. Desktop scan and cache refresh

- [x] 2.1 Reproduce single/concrete scan disagreement and cache-save memory divergence; reuse existing modeling/commit logic and retain regression tests.
- [x] 2.2 Serialize watcher scan/commit and use the existing refresh path in update commands; verify mutex blocking, batch failure rollback, and error propagation boundaries.

## 3. Archive hygiene and verification

- [x] 3.1 Verify external imports are rejected before archive mutation, delete unreachable new-archive branches, and retain historical restore behavior.
- [x] 3.2 Record evidence, severity corrections and skipped restructuring; sync main specs, run CLI/frontend/Rust tests and applicable format/type/lint and OpenSpec/ADR gates, then archive.
