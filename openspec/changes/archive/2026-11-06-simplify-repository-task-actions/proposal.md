# Proposal

## Why

Repository tasks have redundant continuation copy and a prominent text dismissal action. The menu should read as a compact clickable task, with a discreet dismissal control and a clear prepared-repository icon.

## What Changes

- Remove visible continuation and dismissal labels from task entries.
- Show an accessible close icon at the top right of terminal task entries on hover or keyboard focus.
- Use the installed FolderCheck icon for completed preparation, retaining Download and AlertTriangle for other states.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `discover-search`: Compact task entry actions and completion presentation.

## Impact

Task menu component, associated navigation tests and localized copy. No dependencies, backend, persistence or protocol changes.
