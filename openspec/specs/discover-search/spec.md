# Discover Search Specification

## Purpose

Define which skills.sh search sources can be opened as GitHub repositories.

## Requirements

### Requirement: Search results accept valid GitHub sources

The system SHALL retain skills.sh results whose source is a valid GitHub owner/repository pair, including repository names containing dots. It SHALL exclude domain-based sources and malformed pairs before local installation status classification.

#### Scenario: Dotted repository source

- **WHEN** a result source is `citypaul/.dotfiles` or `dmmulroy/.dotfiles`
- **THEN** the result is retained with its original owner and repository name

#### Scenario: Non-GitHub or malformed source

- **WHEN** a source contains a domain owner, an empty segment, extra path segments, or invalid repository characters
- **THEN** it is excluded from GitHub discovery results

### Requirement: Repository loading survives page navigation

During an app session, repository loading SHALL continue when its page is left. Owner, repository and explicit branch SHALL identify a task, with the default branch distinct from named branches. Returning to a running or fresh completed task SHALL reuse its work and retain selected skill keys. Explicit retry or refresh SHALL reuse any in-flight request for the same identity.

#### Scenario: Leave and return during loading

- **WHEN** a user leaves a loading repository and returns before completion
- **THEN** the existing task and progress remain visible and no duplicate repository command starts

#### Scenario: Return after completion

- **WHEN** a user returns to a fresh completed repository
- **THEN** its skill list and prior selections appear without downloading again

#### Scenario: Branch isolation

- **WHEN** two branches of the same repository load
- **THEN** their results, progress and selections remain separate

#### Scenario: Installation status becomes stale

- **WHEN** local installation state changes while a completed repository is in the background
- **THEN** reopening it refreshes installation status instead of offering stale install actions

### Requirement: Discovery installation status follows local changes

Installation and filesystem changes SHALL invalidate discovery installation status. Completed repositories in the background SHALL refresh stale status when revisited, and install actions SHALL wait for that refreshed status.

#### Scenario: Local changes while away

- **WHEN** an installation or filesystem change invalidates a completed hidden repository
- **THEN** it does not reload until revisited, and its install actions remain disabled until current status is available

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

### Requirement: Completion stays quiet while failures may interrupt

Background completion SHALL NOT show a notification, navigate, steal focus, or install skills automatically; the persistent header entry is the completion signal. Failures MAY show a localized notification. Header-entry continuation SHALL use current unsaved-draft navigation protection.

#### Scenario: Completion during other work

- **WHEN** a repository finishes while the user is on another page
- **THEN** that page remains active with no completion toast and the persistent header entry can open the exact repository after any required discard confirmation

### Requirement: Repository reading remains usable during skill loading

Repository metadata and navigation SHALL remain usable while the skill list loads. Discovery repository details SHALL NOT display or request a README. Installation SHALL continue to require the user's skill and agent choices.

#### Scenario: Read while loading

- **WHEN** skill discovery is still pending
- **THEN** the user can inspect repository metadata and leave while discovery continues, without a README section or README request from the discovery detail

### Requirement: Repository task actions remain visually compact

Task entries SHALL open the corresponding repository when activated, without an extra visible continuation label. Terminal task dismissal SHALL use a top-right close icon shown on hover or keyboard focus, with an accessible name and no visible label. Dismissal SHALL NOT also activate repository navigation.

#### Scenario: Compact completion

- **WHEN** a task has completed
- **THEN** no additional choose-skills or open-repository label appears in the entry

### Requirement: Task icons divide state and identity

The header button SHALL use one drive-download icon: its LED dots sweep while any task loads and stand still once all are ready. Task entries SHALL use a repository identity icon; failures use a warning triangle in both places. Reduced-motion settings SHALL keep the icons still.

#### Scenario: Loading animation

- **WHEN** a task is downloading, extracting or scanning
- **THEN** the header icon's LED dots sweep and stop when tasks complete

#### Scenario: Compact completion

- **WHEN** a task has completed
- **THEN** its entry shows the repository identity icon and the all-completed header uses the static drive-download icon

#### Scenario: Dismiss with pointer or keyboard

- **WHEN** a terminal task entry is hovered or keyboard-focused
- **THEN** its close icon is visible and can dismiss that task without opening it

### Requirement: Community GitHub skill discovery
Discover SHALL offer popular and 24-hour trending skills from skills.sh through Rust IPC, alongside independent curated repositories. Cards SHALL identify source and metric period, support keyboard operation, and reveal further entries progressively while scrolling, each batch arriving through a staggered entrance. The first screen SHALL distribute exposure across repositories.

#### Scenario: External catalog unavailable
- **WHEN** a catalog request fails
- **THEN** the last successful catalog is shown as saved results, or a retry state appears if none exists
- **AND** curated repositories remain usable

#### Scenario: Safe catalog intake
- **WHEN** upstream catalog data is read
- **THEN** malformed sources, non-GitHub domains, invalid slugs and duplicates are excluded
- **AND** requests have a timeout and response-size bound

### Requirement: Recommended skills use real repository paths
Opening a community skill SHALL load its repository through existing session tasks, uniquely resolve its real skill key, and preview it. Installation SHALL use that key and the existing agent-selection confirmation. Missing or ambiguous matches SHALL leave repository browsing available without selecting an arbitrary skill.

#### Scenario: Nested skill or root skill
- **WHEN** a catalog slug matches one real nested or root skill
- **THEN** the actual SKILL.md is previewed and its real key is passed to installation
- **AND** the default branch is resolved by the existing repository flow

#### Scenario: Ambiguous match
- **WHEN** multiple repository skills match a catalog slug
- **THEN** no preview or installation is chosen automatically
- **AND** a notice invites the user to choose from the repository list

### Requirement: Running repository loads can be cancelled

Each running repository load SHALL offer cancellation in the task menu using the same compact icon pattern as terminal dismissal, with an accessible name, without navigating to the repository. Activating it SHALL abort the backend load, remove the task entry immediately, and publish no cache entry.

#### Scenario: Cancel from the task menu

- **WHEN** the cancel control of a running task entry is activated
- **THEN** the load stops, the entry disappears immediately, and the view does not navigate

#### Scenario: Cancellation races completion

- **WHEN** the load has already completed when the cancellation command arrives
- **THEN** cancellation is a no-op and the completed result remains available

### Requirement: Cancelled loads are not failures

A cancelled load SHALL NOT be presented as a failure: no failure notification is shown. A repository detail page without previously loaded skills SHALL enter a quiet cancelled state with an explicit reload action instead of error styling; a page holding previously loaded skills SHALL keep them displayed over the cancelled error. Cancellation SHALL persist: neither returning to the repository page nor reopening it SHALL restart the load automatically.

#### Scenario: Detail page of the cancelled repository

- **WHEN** the user cancels the load of the repository they are currently viewing and no skills were loaded before
- **THEN** the detail page leaves the loading state and shows a quiet cancelled state with an explicit reload action

#### Scenario: Previously loaded skills survive a cancelled refresh

- **WHEN** the user cancels a refresh of a repository whose skills were loaded earlier
- **THEN** the detail page keeps showing the previously loaded skills instead of the cancelled state

#### Scenario: Reload after cancellation

- **WHEN** the user activates reload on a cancelled repository
- **THEN** a fresh load starts from the beginning and progress is reported again

#### Scenario: Cancelled load does not interrupt other work

- **WHEN** a background repository load is cancelled from the task menu
- **THEN** no failure notification appears and the current view is unchanged
