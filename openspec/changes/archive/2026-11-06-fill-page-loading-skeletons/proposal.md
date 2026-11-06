# Proposal

## Why

The discovery repository page should not display a README. Existing full-page list skeletons render too few rows or cards to cover the default 1100 × 700 app window.

## What Changes

- Remove README rendering and its query from discovery repository details.
- Fill available list/grid loading regions at the default window size, clipping excess placeholders without creating fake scrollable content.
- Keep navigation, toolbars, header-only placeholders, small cards and modal placeholders at their natural sizes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `discover-search`: Repository loading keeps metadata and navigation available without a README panel.
- `desktop-ui`: Existing full-page skeletons fill their available content regions at the default window size.

## Impact

Frontend layout and associated tests/specs only. Local repository README panels remain supported. No dependencies, IPC, persistence or protocol changes.
