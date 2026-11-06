# Verification

## Result

Repository loads now belong to the app session and keep running across page navigation. Header entries continue into the exact repository/branch, retain skill selection, and offer retry or dismissal. Ready notifications never navigate automatically; their actions respect unsaved editor and creation content. README reading remains independent of discovery.

The final user choice is authoritative: no progress lines and no numeric percentages. The repository refresh button retains its original loading spinner, stage text and available byte counts. The header task icon is static, with byte counts available in the expanded menu. No translation progress UI was changed.

## Automated checks

- `bun run typecheck`, `bun run lint`, `bun run format:check`: passed.
- `bun run test`: 48 files, 443 tests passed.
- `bun run build`: passed. Existing theme-init script and bundle-size warnings remain.
- `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`: 319 unit and 60 integration tests passed; 2 performance tests skipped by default.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `bun run lint:rs`: passed.
- `openspec validate --all --strict`, `adrkit validate --all`, `git diff --check`: passed.

The new session and menu tests cover continued work, default/named branch separation, delayed listener cleanup, known/unknown byte totals, failure/retry/dismissal, observer cancellation deduplication, selection retention, stale installation status, and current notification navigation handlers. App tests cover actual page unmount/remount, README access during loading, explicit installation, and discard/cancel navigation protection for editors and creation forms.

## Browser verification

An isolated browser harness served the production build with mocked Tauri IPC. Chromium and WebKit both passed: two overlapping repositories, known and unknown totals, no progress line/percentage, preserved refresh-position spinner, global task entry, background completion notice, direct continuation, and selection retention. Exactly two discovery commands were made for the two repositories and no install command was made automatically. No browser page errors occurred. Task menu screenshots were visually inspected.

The reported `RepoTasksProvider is required` error appeared during live development, but was not reproduced on fresh development or production navigation. Context creation was separated into a stable module. A development hot-update check then verified that the context object and active repository selection survive a provider/hook module replacement, without the missing-provider error. This is a regression check of that boundary, not proof of the original transient error's cause.

## Download size evidence

Read-only GET header checks against GitHub ZIP URLs gave different outcomes: `luochang212/skill-zoo` used chunked transfer without Content-Length, while `vercel-labs/skills` returned Content-Length 507324. No total is estimated, and no extra size request was added to the application.

## Limits

Browser IPC was mocked; this was not an automated native desktop download or installation test. No Windows/Linux hardware or exact Safari 16.4 runtime was tested. Tasks and selections are session-only. No new dependencies, persistent schemas or protocol fixtures were introduced; ADRs 1 and 3 are unaffected and ADR 5's explicit Unassigned label is preserved.
