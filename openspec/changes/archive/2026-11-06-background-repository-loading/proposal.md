# Proposal

## Why

Leaving a repository currently loses its page-owned progress and selection, with no global continuation entry. Users need to keep browsing and return directly to a prepared skill list without searching again or restarting the load.

## What Changes

- Keep repository queries and progress alive for the current app session.
- Add a header task menu with progress, retry, dismissal, and direct repository navigation.
- Notify background completion without changing page or focus, retaining an entry until viewed or dismissed.
- Retain per-repository skill selections and allow README reading while skill discovery runs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `discover-search`: Background repository loading and continuation into installation.

## Impact

React Query ownership, repository view, header, navigation protection, English/Chinese copy and tests. Rust progress events gain branch identity; no persistence or local protocol changes. No new dependencies or cross-restart recovery.
