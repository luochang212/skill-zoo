# Tasks

## 1. Task actions and notifications

- [x] 1.1 Replace translation and configuration banners with Toast feedback and move stop/retry beside translation; verify failure notification deduplication, retry, repair and end-state tests.
- [x] 1.2 Preserve retry restrictions and stopping from edit mode; verify related UI/hook regressions, frontend checks and build, then sync main specs.

## Verification

- Before implementation, three new pane tests failed on missing toolbar actions/Toast-only behavior. Related five-suite regression run passed 60 tests after the task-context addition; the final three changed suites passed 34 tests, including concise context, icon-only actions and keyboard focus restoration.
- Parallel tasks were tested with distinct sources and an unmounted initiating view: failure and repair messages retain their initiating short context, with separate task notification IDs and no paths or second-line description.
- Typecheck, lint, format, production build, strict change validation and diff whitespace checks passed. Existing build warnings remain.
- The action uses the translation control's height, radius, border and selected background/foreground tokens. Native desktop rendering and assistive-technology announcements were not exercised.
