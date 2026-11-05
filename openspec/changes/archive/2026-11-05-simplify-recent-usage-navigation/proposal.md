# Proposal

## Why

The tray repeats an agent name users already choose in Usage Habits, and offers no direct route back to that view. The Local list scrollbar sits inside page padding instead of at the content edge.

## What Changes

- Use the plain Recently Used title and add View usage above the copy hint in every data state.
- Open the existing Usage Habits dialog through the tray navigation flow, retaining unsaved-edit protection.
- Extend Local list scrolling to the right edge while retaining content spacing, including its loading skeleton.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `skill-usage`: simplified tray presentation and direct usage navigation.

## Impact

Native tray labels/menu, App navigation, settings dialog props, Local list layout and their checks. No persistence or collector changes.
