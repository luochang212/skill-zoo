# Tasks

## 1. Selection and configuration

- [x] 1.1 Share the standalone picker across initial setup and Add service; verify absence of navigation until a provider is selected, and sidebar presence for built-in/custom configuration.
- [x] 1.2 Preserve draft guards, save retry and translation preferences; verify related UI suites and type/lint/build checks, then sync main specs.

## Verification

- Four related UI suites: 48 tests passed. After adding picker-back and custom-sidebar assertions, the affected TranslationSettings suite passed again (30 tests).
- Typecheck, lint, format, production build, strict change validation and diff whitespace checks passed.
- Both entry points use the same picker branch; tests assert service navigation and the add button are absent there, and navigation returns for built-in and custom configuration. New drafts are marked unsaved and existing draft guards/save retries remain covered.
- Desktop visuals were not verified interactively. No backend or persistent-state changes.
