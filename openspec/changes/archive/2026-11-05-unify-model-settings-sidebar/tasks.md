# Tasks

## 1. Unified management

- [x] 1.1 Remove standalone model creation routes and keep sidebar template/editor states; verify existing provider tests and empty setup/add/save scenarios.
- [x] 1.2 Guard new-service drafts on switching and canceling; verify retention/discard and save-failure retry tests without changing translation preferences.

## 2. Integration

- [x] 2.1 Run model/translation UI tests, typecheck, lint, format and production build; validate and sync main specs.

## Verification

- 4 related UI suites passed: 48 tests, covering translation entry/back navigation, first setup, creation with persistent sidebar, save failure/retry, unsaved-draft retention/discard, existing-service autosave and model parameter dialogs.
- Frontend typecheck, lint, format check, production build and strict change validation passed. Build retains existing classic theme-init script and bundle-size warnings.
- Production model-settings code is smaller after removing outer template/editor routes and duplicate save ownership. No backend, persistence or credential API changes.
- Desktop rendering and narrow-window scrolling were reviewed from the existing responsive grid and form constraints, not verified through native desktop interaction.
