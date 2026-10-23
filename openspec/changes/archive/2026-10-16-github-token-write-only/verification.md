# Verification

Date: 2026-10-15

## Gates

- `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` reports 214 passed, 0 failed (two new tests: `visible_settings_omits_credential_keys_only`, `credential_status_reports_existence_and_expiry_without_token`; the status serialization is asserted to carry no token material).
- `bun run test` covers 33 files with 205 tests passed (18 in the rewritten GitHubTokenSettings suite).
- `bunx tsc --noEmit` is clean.
- `openspec validate --all --strict` passes with 13 passed, 0 failed.
- `cargo fmt --check` is clean.

## What the tests pin down

- Renderer never receives the secret: `get_settings` filters `github_token`/`github_token_expires_at` (Rust test on the pure helper); the component mocks now serve credential state exclusively via `get_github_credential_status` and the suite asserts saved state arrives through that command.
- Write-only dialog: input empty on open even with a saved token; save clears the input; status line carries state/quota/expiry without the secret.
- Removal: empty-input submit is a no-op (save button disabled on empty draft, submit guard returns early); the two-step remove button calls `save_github_credentials("")` with no network verification; typing disarms the armed confirm.
- Regression coverage kept for verify-before-save ordering, failed persistence leaving state untouched, IME-safe Enter, zh copy, expiry rows.

## Deviations / notes

- `SkillMaintenanceSettings.test.tsx`: all nine settings-page mocks gained the `get_github_credential_status` case, because every one of them renders `SettingsView`, whose `GitHubTokenSettings` now queries the status command; the old `get_settings`-only mocks rejected it as an unexpected command.
- One rewrite casualty: the old "removes a whitespace-only token" test encoded the clear-and-save removal contract that this change intentionally retires; its replacement is the explicit two-step removal test plus the empty-submit no-op test.
- The `get_settings`/`get_github_credential_status` command wiring (lock + helper call) is inspection-reviewed per repo test pattern; the pure helpers carry the behavioral assertions.

## Replace-only revision (same day)

Product-owner decision after reviewing the dialog: the credential is strictly replace-only. Saving a new token replaces the old one, and the two-step remove button is dropped entirely.

- Component: remove button and its arm/disarm state deleted; the save button disabled on an empty draft remains the only empty-submit guard.
- Placeholder: saved state also reads at the input itself via a full-width mask placeholder (code-generated, foreground-colored). It is placeholder text, never a value. Glyph verified against the real password mask with Playwright WebKit on macOS: the mask uses the system font's U+F79A secure-dot glyph (WebKit commit 69d20a8), and a `\uF79A` placeholder measures identical (6.0px dots, 2.7px gaps at 14px; `•` was 2.7px, `●` was 11.0px). Non-macOS engines draw plain U+2022 bullets and the placeholder matches with the same character.
- Tests: the two-step-remove and disarm tests are replaced by "offers no removal affordance because saving a new token is the only way a credential changes"; suite is now 16 tests.
- Specs: delta requirement renamed `Token removal and startup` → `Token replacement and startup` and rewritten (single-write replacement, no removal affordance); main spec synced; design/proposal/tasks reconciled.
- Trade-off accepted: no in-app path back to anonymous. GitHub-side revocation is the real de-authentication; the app surfaces a dead token through expiry metadata or loud 401s, and replace fixes both.
- Gates re-run: component suite 16/16, `bun run test` green, `bunx tsc --noEmit` clean, `bun run lint` clean, `openspec validate --all --strict` green. Rust is untouched by this revision. The backend's empty-token save semantics remain defined but no UI path calls them.

## Revision 2 (mask as real value, same day)

Product-owner review of the placeholder mask found the dead affordance: placeholder text cannot be selected or deleted, so the select-all → paste habit read as a broken field. Decision: the mask becomes a real value, guarded by two rules.

- Component: draft is three-state (`null` = untouched → value derives to the mask; no fill effects, late status loads included). Save disabled while the draft contains mask characters (untouched / partially cleared / pasted-back are all "unchanged"). Focus selects all while unchanged; `mousedown` is preventDefaulted because the click's default caret placement collapses focus- and mouseup-based selections. This is a real-WebKit ordering bug jsdom cannot reproduce, found via Playwright interaction probes. After a successful save the input reverts to the mask.
- Glyph unchanged: U+F79A on macOS WebKit, plain bullet elsewhere (see Revision 1 for the measurement).
- Placeholder returns to instructional copy ("输入新 Token 以替换" / "Enter a new token to replace it"), visible only after the user clears the mask.
- Tests: suite is 18, covering mask-stand-in + never-the-token, unchanged-guard (untouched/partial/mixed all disabled), non-macOS bullet value, replace flow restoring the mask, plus prior coverage; three tests gained `user.clear` (mask is now the starting value).
- Specs: "Saved credential is never redisplayed" rewritten (mask stand-in + unchanged-guard + ordinary-editing semantics); "Empty input does not change state" scenario → "No new token entered" (empty or unchanged mask). Main spec synced; design/proposal/tasks reconciled.
- Gates re-run: component 18/18, `bun run test` 33 files green, tsc clean, lint clean, `openspec validate --all --strict` green.

## Revision 3 (no auto-selection, same day)

Product owner: the dialog must not auto-select the token field on open. The select-all-on-focus/`mousedown` behavior (revision 2's experience guardrail) is removed entirely. The mask behaves like any ordinary text value: focus places a caret, selection is the user's (select-all → delete → paste, matching the old prefilled-field habit). The unchanged-guard still blocks spliced states from being submitted, so removing the guardrail has no correctness impact. Spec: "Mask behaves like content" scenario now ends "with no automatic selection". Design decision 5 records the removed guardrail and the Playwright finding (click caret placement collapses focus/mouseup selections) as the reason a naive re-add would not work.
- Gates re-run: component 18/18, full suite green, tsc clean, lint clean, `openspec validate --all --strict` green.

## Revision 4 (dialog verifies the saved token on open, same day)

Product owner: reopening the dialog after navigation only ever showed "Token configured · save to verify its current quota". That copy invited a write just to see information, and there was no way to notice a GitHub-revoked token until updates failed. Decision: a live check on dialog open (infrequent surface; `GET /rate_limit` is free).
- Backend: the new `verify_saved_github_token` command reads the token from the settings mutex in a scoped block (the guard must not cross the await: std MutexGuard is not Send), reuses `services::github::verify_github_token`, and returns only the result. Write-only holds: the credential never crosses the bridge.
- Frontend: `useGitHubTokenVerification` query, enabled while the dialog is open with a saved token, `staleTime: 30s`; a successful save seeds the cache with its fresh verification (quick reopen skips the refetch). Dialog status priority: fresh save → live-check truth (beats stale persisted expiry) → "verifying" → persisted-expired → configured fallback; an unauthenticated verdict renders "Token no longer valid" in amber (shared with the row) and a transport failure silently keeps the saved-state line. "Verification failed" copy stays reserved for the save flow.
- i18n: added `verifying` + `tokenInvalid` (zh/en); removed `configured` (dialog fallback now shares `configuredShort`, which required scoping two dialog assertions with `within(dialog)`).
- Tests: 3 new component tests (live quota shown + no args on the bridge call, unauthenticated → amber invalid line with credential unchanged, transport failure → saved-state fallback). Suite 21 in this file, 208 overall; cargo 214 (new command is a thin wrapper over the already-tested service routine, no dedicated Rust test).
- Specs: ADDED "Dialog verifies the saved credential" (delta + main spec). Gates re-run: cargo + fmt, component 21/21, full suite, tsc, lint, `openspec validate --all --strict` green.

## Review addendum (presentation changes kept, commit-review fixes)

Commit review flagged diff areas no change doc claimed: the settings section retitle "GitHub Connection" → "Advanced features" (`SlidersHorizontal` icon), row copy "GitHub API access token", and the section move below Skill Companion. Kept deliberately (product decision at review) and now recorded in proposal What Changes/Impact so the change owns everything it ships; no test asserts the section title or icon.

Review fixes applied in the same pass:

- The write guard derives from `CREDENTIAL_KEYS`, so one list now backs both the read filter and the write guard (consistency: a future credential key cannot drift between the two mechanisms), and the rejection error names `save_github_credentials` explicitly.
- `verify_saved_github_token` treats a blank/whitespace token as absent via a new `verifiable_saved_token` helper, the same "configured" view `credential_status` reports (Rust test `verifiable_saved_token_matches_the_status_view_of_configured`); a legacy whitespace token can no longer reach GitHub through a stale path.
- The dialog's save-gate predicate is deduplicated into `canSave` (submit guard and button disabled state shared).
- Stale proposal wording reconciled with Revision 2 (mask as a real value, not "saved-dots placeholder"; no "clear-on-save").
