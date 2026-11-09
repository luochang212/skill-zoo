# Tasks

## 1. Single instance

- [x] 1.1 Add `tauri-plugin-single-instance` and register it as the first plugin; verify build and clippy pass.
- [x] 1.2 Verify a second launch focuses the existing window and exits (live double-launch check).

## 2. CSP tightening

- [x] 2.1 Remove the stale GitHub domains from `connect-src`; verify the config still builds and the app loads without CSP violations.

## 3. Feedback error path

- [x] 3.1 Replace the dead `window.open` fallback with a toast error; verify with a component test that opener failure shows exactly one error and never calls `window.open`.
- [x] 3.2 Add the `settings.feedback.openError` key to both languages; verify typecheck, lint, format, full frontend test suite and strict OpenSpec validation.
