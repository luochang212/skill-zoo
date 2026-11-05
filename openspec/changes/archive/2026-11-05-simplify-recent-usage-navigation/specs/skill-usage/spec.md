## MODIFIED Requirements

### Requirement: Shared selected usage agent
Usage Habits and the tray's Recently Used menu SHALL use the same saved usage-agent setting, preferring Codex when the saved selection is unavailable, then the first available tracked agent. Selection changes SHALL become visible after successful persistence; failed saves SHALL retain the previous selection and show an error. A valid selected agent with empty or unreadable usage SHALL NOT fall back to another agent.

#### Scenario: Select ZCode
- **WHEN** the user selects ZCode and saving succeeds
- **THEN** the dialog and tray read ZCode, while the tray title remains Recently Used without an agent suffix

#### Scenario: Selection save fails
- **WHEN** saving a new selection fails
- **THEN** both consumers retain the prior selection and the dialog reports the failure

### Requirement: Recent usage presentation and refresh
Recently Used SHALL distinguish initial loading, successful records, successful empty usage, and read failure, and SHALL use the plain Recently Used title without an agent suffix. Results SHALL remain time-ordered, deduplicated by skill, and limited to five. It SHALL offer retry after failure and retain same-agent old results during refresh.

#### Scenario: Fresh agent has no result yet
- **WHEN** switching to an agent with no cached result
- **THEN** loading is displayed without another agent's records

#### Scenario: Missing versus unreadable store
- **WHEN** the selected store is absent or unreadable
- **THEN** absence produces an empty state, while read failure produces an error and retry

## ADDED Requirements

### Requirement: Tray usage navigation
Recently Used SHALL offer View usage in loading, empty, success and failure states. It SHALL appear above the copy hint when records exist and open the existing Usage Habits dialog for the saved agent. Navigation SHALL respect unsaved-edit confirmation.

#### Scenario: Open usage from the tray
- **WHEN** the user clicks View usage
- **THEN** the main window opens the Usage Habits dialog, closing a clean detail view or requesting confirmation for unsaved edits first
