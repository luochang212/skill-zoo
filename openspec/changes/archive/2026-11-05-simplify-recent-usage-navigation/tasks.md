# Tasks

## 1. Tray and navigation

- [x] 1.1 Simplify the menu title and add the usage action in all states; verify Rust checks and bilingual labels.
- [x] 1.2 Route the action to the existing usage dialog through the navigation guard; verify App navigation integration test.

## 2. Layout and integration

- [x] 2.1 Move Local scrolling to the content edge in loaded and skeleton views; verify build and review layout boundaries.
- [x] 2.2 Run related tests, typecheck, lint, format and strict OpenSpec validation; sync main specs and record verification limits.

## Verification

- App integration tests: 4 passed, including native navigation from an open detail into the existing usage dialog. Settings usage tests: 19 passed.
- Tray Rust unit tests: 6 passed; standard Clippy, frontend typecheck/lint/format and production build passed.
- Layout review confirms the scrolling row extends across the outer right padding, with spacing moved inside the viewport and container queries measuring the original content width; loaded and skeleton views match.
- Native menu clicking and the final scrollbar position were not verified through desktop interaction. No new platform APIs or dependencies were added. Existing build warnings about the classic theme-init script and bundle size remain.
