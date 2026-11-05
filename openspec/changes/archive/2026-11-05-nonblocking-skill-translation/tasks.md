# Tasks

## 1. Nonblocking translation

- [x] 1.1 Reproduce the initial blank pane and retain the original until first text; verify real-hook pane tests for initial wait, streaming, retranslation, failure and cancellation.
- [x] 1.2 Adapt genesis intent progress to real task states, completion and reduced motion; verify accessibility and browser rendering without intercepting reading.

## 2. Integration

- [x] 2.1 Run related pane/translation tests, type/lint/format/build checks and strict spec validation; sync main specs and record verification boundaries.

## Verification

- Before the fix, the original-visible UI regression failed because the initial streaming gate replaced the original with a spinner.
- Five related suites passed: 54 tests. The new real-hook pane suite covers initial waiting, successful completion, old-result retention on retranslation, failure, streaming preview and explicit cancellation.
- Frontend typecheck, lint, format and production build passed. Strict change validation and diff whitespace checks passed.
- Chromium rendered the real pane with mocked IPC: original visible and scrollable, progress height 2px and pointer-events:none, reduced-motion animation disabled, successful completion switched to translated content and removed active progress. Screenshot inspected at /tmp/skill-zoo-translation-pending.png. Temporary browser harness and dev server removed after verification.
- Native WKWebView/WebView2/WebKitGTK and real model requests were not exercised. Existing cached-first-read loading behavior was retained.
