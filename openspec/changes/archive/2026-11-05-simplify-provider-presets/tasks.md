# Tasks

## 1. Preset selection

- [x] 1.1 Reduce the picker to three presets plus Custom, update onboarding tests to exercise Volcengine and verify removed presets are absent.
- [x] 1.2 Verify 34 related UI tests, frontend type/lint/format checks, strict specification validation and clean diff whitespace; sync the main spec.

## Verification

- TranslationSettings and ModelProvidersSection suites: 34 tests passed, including Volcengine URL/protocol prefill, autosave retry and absence of removed preset cards.
- Official Volcengine documentation confirms the OpenAI-compatible API root. Real-key calls were not performed.
- Only preset data and UI expectations changed; existing saved services and backend protocol handling were untouched.
