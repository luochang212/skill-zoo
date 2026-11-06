# Verification

- Removed visible entry continuation and dismissal labels; retained whole-entry navigation, retry, and localized accessible close names.
- Completed entries and the completed header use the installed FolderCheck icon. Loading keeps Download; errors use AlertTriangle.
- Dismissal is a separate sibling menu item positioned top-right, revealed by row hover or focus-within. It is not nested inside the navigation item.
- Menu and App regression tests pass, including navigation with unsaved drafts and dismissal without opening a repository.
- Full frontend suite: 48 files, 443 tests passed. Typecheck, lint, format check and production build passed. Existing build warnings remain.
- Chromium/light and WebKit/dark tests against the production build with mocked Tauri IPC verify: no visible continuation/dismiss labels, FolderCheck on completion, close opacity zero before row interaction and one on hover or keyboard focus, pointer dismissal, arrow-key/Enter dismissal, and no accidental repository navigation. Screenshots were visually inspected.
- OpenSpec strict validation, ADR validation and whitespace checks passed. Main discover-search spec includes the added requirement.

No backend changes or native desktop IPC verification in this task; Rust tests were not repeated. The standard house dropdown retains its existing keyboard handling; no second navigation system or dependency was added.
