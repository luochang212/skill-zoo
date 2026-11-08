# Tasks

## 1. Cache safety

- [x] 1.1 Preserve active temporary files, links and unrelated cache files; verify production clear/size regression tests and document the scope.
- [x] 1.2 Re-read cache size after a clearing attempt; verify frontend regression covering concurrent publication and existing failure feedback.

## 2. Update correctness

- [x] 2.1 Bind extracted archive identity to baseline lookup and reject a different checked snapshot; verify archive extraction and mismatch tests.
- [x] 2.2 Commit each lock entry before removing its directory backup; verify lock-write fault injection restores content and baseline, plus existing edit protection tests.
- [x] 2.3 Stop automatic unknown-version baselining; update protocol docs/shared fixture and verify Rust/CLI preservation plus status reporting tests.

## 3. Plugin interaction and triage

- [x] 3.1 Measure the real plugin scanner; retain timings and explicit limits in the worth-fix report.
- [x] 3.2 Keep the plugin mutation pending through refresh and reuse its result; verify switch state and request-count regression.
- [x] 3.3 Record each accepted/deferred/withdrawn recommendation and its impact/cost; do not ship unmeasured scanning or rendering redesigns.

## 4. Integration

- [x] 4.1 Run frontend, Rust and CLI tests, lint/typecheck/format and strict OpenSpec/ADR validation; record actual results and synchronize affected main specs.
