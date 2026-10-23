# Design

## Context

The runtime token slot (`config::GITHUB_TOKEN`) stores a bare `Option<String>` refreshed at startup from `settings["github_token"]` and after saves. `github_get` attaches whatever the slot holds; nothing reads `settings["github_token_expires_at"]`, which the UI persists only for display. Saves currently take two `update_setting` calls, so a failure between them can pair a new token with a stale past expiry. Under the new expiry check that would silently disable a valid token until restart.

## Decisions

1. **Skip at request time, never clear storage.** `config::github_token()` returns the token only while its recorded expiry has not passed; the settings values stay intact so the row keeps showing "Token expired (date) · running with anonymous quota", which becomes accurate. Clearing at startup or save time would lose the user's credential and hide why requests are anonymous.
2. **Loud failure stays the default for unknown state.** Tokens with no expiry or an unparseable expiry value are still attached, so revoked credentials keep producing visible errors. This reconciles with the original "no anonymous fallback for invalid saved credentials" decision: that rule guards against *concealing* invalid credentials, while expiry is metadata the app itself displays. Skipping it is a visible, advertised downgrade, not concealment.
3. **One authoritative credential write.** A new `save_github_credentials` command owns trimming, empty-token removal (both keys), one `settings.save()`, rollback of in-memory settings on failure, and only then a runtime slot refresh. The `update_setting` special case for `github_token` is removed: keeping a second write path that refreshes the token without its expiry is exactly the inconsistency being fixed.
4. **Slot shape.** Store `GitHubCredentials { token, expires_at: Option<DateTime<Utc>> }` (expiry parsed once at set time). `github_token()` filters expired credentials at read; the check is a clock comparison, so no extra I/O or locking across awaits.
5. **No UI change.** The amber warning inside seven days, the expired row line, and the clear-to-remove guidance already describe the new behavior; only the backend was missing.

## Risks / Trade-offs

- [Clock skew] A local clock ahead of real time can skip a token that GitHub still accepts; the row shows expired/anonymous and recovers once the token is saved again or the clock is fixed.
- [Revoked tokens without expiry metadata] Still attached, so their 401s keep surfacing as repository-unavailable diagnostics; unchanged trade-off, documented as out of scope.
- [Expiry metadata from another writer] Only the new command writes the credential keys; a future direct `update_setting` write of `github_token_expires_at` would bypass the slot refresh, which is why the spec records that credential changes go through the save command.

## Migration Plan

None. Existing settings files already contain both keys; a missing or unparseable expiry keeps the previous behavior (token attached). Removing the token still restores anonymous requests.
