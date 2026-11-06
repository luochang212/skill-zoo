## ADDED Requirements

### Requirement: Repository task actions remain visually compact

Task entries SHALL open the corresponding repository when activated, without an extra visible continuation label. Terminal task dismissal SHALL use a top-right close icon shown on row hover or keyboard focus, with an accessible name and without a visible dismissal label. The completed state SHALL use a folder-with-check icon. Dismissal SHALL NOT also activate repository navigation.

#### Scenario: Compact completion

- **WHEN** a task has completed
- **THEN** its entry and the all-completed header use the folder-with-check icon, and no additional choose-skills or open-repository label appears in the entry

#### Scenario: Dismiss with pointer or keyboard

- **WHEN** a terminal task entry is hovered or keyboard-focused
- **THEN** its close icon is visible and can dismiss that task without opening it
