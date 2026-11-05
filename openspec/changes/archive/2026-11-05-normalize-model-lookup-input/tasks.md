# Tasks

## 1. Input corrections

- [x] 1.1 Normalize identity without clearing parameters for whitespace-only edits, and suspend lookup until composition completes; verify both regressions fail before the fix and pass afterward.
- [x] 1.2 Run model-editor regression suite and frontend checks; sync the affected specification.

## Verification

- Original implementation: both added regression tests failed on the reported behaviors.
- Fixed implementation: all 15 ModelEditorDialog tests passed, including existing manual-input and stale-result isolation tests.
- Native IME behavior was not exercised; composition start/change/end was verified through component events.
