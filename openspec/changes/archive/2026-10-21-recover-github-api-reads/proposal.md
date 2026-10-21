# Proposal

## Why

Saving a valid GitHub token does not refresh failed or degraded repository reads. GitHub metadata and README failures also hide authentication and quota recovery information.

## What Changes

- Retry repository metadata, README and repository searches after successful credential saves, preserving valid disk caches and deferring inactive queries until observed.
- Classify GitHub authentication, quota and explicit permission failures consistently across API reads; localize actionable guidance and quota reset times.
- Preserve offline fallbacks, anonymous operation and non-rate-limit 403 batch continuation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `github-connection`: Credential-save recovery and structured API failure guidance.

## Impact

Rust GitHub consumers and command errors, repository/settings hooks, repository and update error displays, English/Chinese translations and regression tests. No dependencies or local protocol changes.
