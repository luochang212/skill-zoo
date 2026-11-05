# Tasks

## 1. Shared original editor

- [x] 1.1 Delete the manual form branch and restore original rename/menu/autosave for new providers; verify UI suites and deletion without unwanted writes.
- [x] 1.2 Serialize first creation and later updates without resetting input; verify a deferred-first-save regression test and failure/retry tests.
- [x] 1.3 Increase provider names to 16px semibold; verify formatting and build.

## 2. Integration

- [x] 2.1 Run related UI suites, typecheck, lint, format and production build; validate and sync the affected model configuration requirements.

## Verification

- Four related UI suites passed: 50 tests. New coverage checks first-create queued updates reuse the assigned ID without dropping newer input, and unsaved custom drafts delete through the original three-dot menu without persistence.
- Existing tests cover inline rename/IME cancellation, API-key safety, autosave failures/retry, switching/closing guards and translation target independence. Creation tests assert no permanent name textbox or Save/Cancel footer.
- Typecheck, frontend lint/format, production build, strict change validation and diff whitespace checks passed. Existing build warnings remain.
- No backend or schema changes. Native desktop visual inspection has not been performed.
