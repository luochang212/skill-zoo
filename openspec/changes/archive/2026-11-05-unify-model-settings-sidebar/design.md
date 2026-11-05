# Design

## Context

AiSettingsDetail owns standalone template/editor routes, while ModelProvidersSection owns sidebar selection, ordered autosave and the unsaved-navigation guard. Both already use ProviderEditor.

## Goals / Non-Goals

Unify the visible shell and navigation owner. Preserve manual creation, existing-service autosave, validation and translation target independence. No backend or on-disk changes.

## Decisions

Move template selection and new-service form into ModelProvidersSection's right pane. Keep the existing provider list and responsive grid mounted, even when empty. Remove creation routing, duplicate save state and footer from AiSettingsDetail rather than adding another presentation option. A local template-or-editor state extends the existing selection; the existing write queue and navigation guard cover both manual and automatic saves. Save success selects the new persisted provider.

## Risks / Trade-offs

- Narrow detail panes → reuse minmax(0,1fr), min-width:0 and narrow-window stacking; scroll the form while keeping its footer visible.
- Leaving a new draft → use the same unsaved confirmation for sidebar switches, cancel, dialog close and translation back navigation; regression tests cover both retained and discarded drafts.
