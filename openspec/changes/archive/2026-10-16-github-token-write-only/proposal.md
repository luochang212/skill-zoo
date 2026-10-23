# GitHub Token Write-Only UI

## Why

The product contract for the GitHub credential is "enter once, never see again". The current UI breaks it in three places: the dialog prefills the saved token into the (password-masked) input, the saved token stays in the input after a successful save, and the generic `get_settings` command ships the raw token and its expiry to the renderer process on every call. A security review of the token feature recorded this renderer exposure as an accepted trade-off pending exactly this redesign.

## What Changes

- `get_settings` SHALL stop returning the credential keys `github_token` and `github_token_expires_at` (server-side filter, not UI hiding).
- A new `get_github_credential_status` command returns only `{ hasToken, expiresAt }`, so saved state is available without the secret.
- The credential dialog never shows the saved token: the input stands in for it with a code-generated mask value (identical to a password mask), and saved state is communicated by the existing status line (state, quota, recorded expiry) which never contains the token.
- The credential is replace-only: saving a new verified token replaces the old one in a single write and the UI offers no removal action; the retired "clear the input and save" removal only made sense with prefill and would misfire on an empty-by-default input.
- `useGitHubToken` + `useGitHubTokenExpiresAt` merge into one `useGitHubCredentialStatus` query (one IPC roundtrip, one invalidation).
- i18n: `clearHint` is removed; the replace-variant placeholder copy returns for the cleared-mask state (zh + en); the saved-credential mask value is code-generated.
- New `verify_saved_github_token` command verifies the saved token server-side (the credential never crosses the bridge); opening the dialog with a saved token fires a live check and shows the current quota, marks a GitHub-rejected token no longer valid, and falls back to the saved-state line when GitHub is unreachable.
- Presentation-only, unrelated to the write-only contract but shipped here deliberately: the settings section is retitled "Advanced features" (`SlidersHorizontal` icon), the row copy becomes "GitHub API access token", and the section moves below Skill Companion.

## Capabilities

### Modified Capabilities

- The `github-connection` removal requirement is renamed and rewritten as replacement-only ("Token replacement and startup", no removal affordance), and a never-redisplay requirement is added.

## Impact

- `src-tauri/src/commands/settings.rs` gains the `get_settings` filter and the new status command (both as testable pure helpers over the settings map).
- `src-tauri/src/lib.rs` registers the status command.
- In `src/lib/api/settings.ts` and `src/hooks/useSettings.ts`, the status query replaces the two token hooks.
- The dialog in `src/components/settings/GitHubTokenSettings.tsx` has no prefill, uses a mask stand-in for the saved token, and is replace-only (no removal affordance).
- The GitHub section moves below Skill Companion in `src/components/settings/SettingsView.tsx` (presentation-only, see What Changes).
- `src/i18n/zh.json`, `src/i18n/en.json`, component tests.
- Storage itself is unchanged (this is the read/display surface; at-rest permissions were hardened separately in `credential-storage-hardening`).
