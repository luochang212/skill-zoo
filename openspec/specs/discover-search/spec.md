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

The app header SHALL expose active repository tasks and unviewed terminal tasks across views. It SHALL show loading stages, byte progress, failures with retry, and successful preparation with a direct action to the corresponding skill list. Completed or failed entries SHALL remain until viewed or dismissed. The task UI SHALL remain keyboard-operable and expose accessible progress names.

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

### Requirement: Completion notifications preserve the current activity

Background completion SHALL provide a localized notification without actions. Completion SHALL NOT navigate, steal focus, or install skills automatically. Header-entry continuation SHALL use current unsaved-draft navigation protection.

#### Scenario: Completion during other work

- **WHEN** a repository finishes while the user is on another page
- **THEN** that page remains active and the persistent header entry can open the exact repository after any required discard confirmation

### Requirement: Repository reading remains usable during skill loading

Repository metadata and navigation SHALL remain usable while the skill list loads. Discovery repository details SHALL NOT display or request a README. Installation SHALL continue to require the user's skill and agent choices.

#### Scenario: Read while loading

- **WHEN** skill discovery is still pending
- **THEN** the user can inspect repository metadata and leave while discovery continues, without a README section or README request from the discovery detail

### Requirement: Repository task actions remain visually compact

Task entries SHALL open the corresponding repository when activated, without an extra visible continuation label. Terminal task dismissal SHALL use a top-right close icon shown on row hover or keyboard focus, with an accessible name and without a visible dismissal label. The completed state SHALL use a folder-with-check icon. Dismissal SHALL NOT also activate repository navigation.

#### Scenario: Compact completion

- **WHEN** a task has completed
- **THEN** its entry and the all-completed header use the folder-with-check icon, and no additional choose-skills or open-repository label appears in the entry

#### Scenario: Dismiss with pointer or keyboard

- **WHEN** a terminal task entry is hovered or keyboard-focused
- **THEN** its close icon is visible and can dismiss that task without opening it
