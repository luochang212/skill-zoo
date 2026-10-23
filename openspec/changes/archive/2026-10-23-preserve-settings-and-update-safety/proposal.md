# Proposal

## Why

The unreleased visibility-key rename discards existing users' effective preference. Update drift protection and completion feedback also have gaps that can lose edits made during download or make unfinished updates appear complete.

## What Changes

- Read the legacy hide preference inversely only when the new show preference is absent, without rewriting either value.
- Recheck drift immediately before replacing prepared skill content, carrying explicit per-skill overwrite consent through the update service.
- Keep unfinished update candidates available and report skipped skills from the app-wide completion listener.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-skill-scope`: preserve existing non-SSOT visibility choices across the setting rename.
- `skill-installation`: protect edits made during update preparation and retain per-skill recovery actions.
- `desktop-ui`: include skipped modifications in background completion notifications.

## Impact

Settings hooks, update settings/dialog state, app-wide notifications, and Rust update preparation/replacement. No dependency, lock/archive schema or plugin-discovery changes. ADR 1 continues to govern local state; these are local corrections, not a new architecture. Settings compatibility is documented and covered by desktop-owned fixtures and frontend/Rust/CLI tests. Reproduction and trade-offs will be retained in design.md.
