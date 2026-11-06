# Design

## Context

The existing house dropdown supplies keyboard navigation. Keep opening, retrying and dismissing as separate menu items rather than nesting interactive controls inside a clickable task.

## Decisions

Position the dismissal item at the row's top right, with opacity revealed by row hover or focus-within. Reserve space in the main item so the controls do not overlap. Retain its localized accessible name. FolderCheck comes from the installed icon library and needs no custom SVG or dependency.
