# Discover Search Specification

## MODIFIED Requirements

### Requirement: Global repository tasks provide continuation

The app header SHALL expose active repository tasks and unviewed terminal tasks across views. It SHALL show loading stages, byte progress, failures with retry, and successful preparation with a direct action to the corresponding skill list. Running repository loads SHALL offer cancellation from the task menu. Completed or failed entries SHALL remain until viewed or dismissed. The task UI SHALL remain keyboard-operable and expose accessible progress names.

#### Scenario: Background repository becomes ready

- **WHEN** discovery completes after the user leaves its page
- **THEN** a notification without actions reports completion and a persistent header entry opens that exact repository and branch

#### Scenario: Failure and retry

- **WHEN** a background repository load fails
- **THEN** its header entry retains the error and offers retry without requiring another search

#### Scenario: Known or unknown download length

- **WHEN** the ZIP response supplies a positive total length
- **THEN** the UI shows downloaded and total byte counts; when length is unknown it shows downloaded bytes alone. Neither case adds a progress line or numeric percentage. The repository refresh control retains its existing loading spinner and stage text.

#### Scenario: Continue while editing

- **WHEN** a user activates continuation with unsaved editor or creation content
- **THEN** navigation requires discard confirmation and cancellation preserves the current content

## ADDED Requirements

### Requirement: Running repository loads can be cancelled

Each running repository load SHALL offer cancellation in the task menu using the same compact icon pattern as terminal dismissal, with an accessible name, without navigating to the repository. Activating it SHALL abort the backend load, remove the task entry immediately, and publish no cache entry.

#### Scenario: Cancel from the task menu

- **WHEN** the cancel control of a running task entry is activated
- **THEN** the load stops, the entry disappears immediately, and the view does not navigate

#### Scenario: Cancellation races completion

- **WHEN** the load has already completed when the cancellation command arrives
- **THEN** cancellation is a no-op and the completed result remains available

### Requirement: Cancelled loads are not failures

A cancelled load SHALL NOT be presented as a failure: no failure notification is shown, and a repository detail page left loading SHALL enter a quiet cancelled state with an explicit reload action instead of error styling. Cancellation SHALL persist: neither returning to the repository page nor reopening it SHALL restart the load automatically.

#### Scenario: Detail page of the cancelled repository

- **WHEN** the user cancels the load of the repository they are currently viewing
- **THEN** the detail page leaves the loading state and shows a quiet cancelled state with an explicit reload action

#### Scenario: Reload after cancellation

- **WHEN** the user activates reload on a cancelled repository
- **THEN** a fresh load starts from the beginning and progress is reported again

#### Scenario: Cancelled load does not interrupt other work

- **WHEN** a background repository load is cancelled from the task menu
- **THEN** no failure notification appears and the current view is unchanged
