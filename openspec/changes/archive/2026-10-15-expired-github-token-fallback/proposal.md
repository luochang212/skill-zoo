# Proposal

## Why

A saved fine-grained token keeps being attached to every GitHub API read after its recorded expiry passes. GitHub answers 401, the update checker maps 401 like 404, and every repository is reported as "Repository or branch could not be found", while the settings row simultaneously states the app runs with the anonymous quota. The shipped copy promises a degradation the request path never implemented, so the app misleads exactly when GitHub features break. Expired tokens are the designed-for case (the expiry display exists because they are common), and the failure is sticky across restarts until the user manually replaces or clears the token.

## What Changes

- Treat a saved token whose recorded expiry has passed as absent when building GitHub API requests, so reads fall back to the anonymous quota the settings row already advertises.
- Keep attaching tokens with no recorded expiry or an unparseable expiry value, so revoked or invalid credentials still fail loudly instead of being silently downgraded.
- Replace the two sequential `update_setting` writes (token, then expiry) with one atomic `save_github_credentials` command that persists both values in a single settings write and refreshes runtime credentials only after a durable save.
- Record the expired-token behavior and atomic credential save in the github-connection main spec.

## Capabilities

### Modified Capabilities

- `github-connection`: expired saved tokens no longer authenticate API reads; credential persistence becomes a single atomic write.

## Impact

Desktop Rust config/settings/GitHub services, the settings IPC surface, and the React save hook plus its component tests. English/Chinese copy is unchanged; the existing expired-token row text becomes true. No dependency, CLI, local-protocol fixture, cache, or encryption changes; revoked-token diagnostics outside expiry (401 mapped to repository-unavailable) are a separate, unchanged trade-off.
