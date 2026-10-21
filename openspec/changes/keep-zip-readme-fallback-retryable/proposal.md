# Proposal

## Why

A confirmed P2 recovery defect persists after credential saves: when a README API read fails, a cached ZIP README is persisted with a new seven-day freshness timestamp. Subsequent reads skip GitHub even after a token is configured.

## What Changes

- Keep ZIP-derived README cache entries stale and retryable while retaining their content for offline use.
- Add a production-command regression test for failure → ZIP fallback → credential change → network retry, plus a fresh API cache control.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `github-connection`: Explicitly include ZIP fallback content in credential-save recovery.

## Impact

One Rust cache write branch and a backend regression test. No frontend, downloads, dependencies or local protocol schema changes. A temporary-directory production-function probe already reproduced two old-README returns with only one network attempt before this fix. The regression uses a local failing proxy and fake credentials, without accessing real user files or GitHub.
