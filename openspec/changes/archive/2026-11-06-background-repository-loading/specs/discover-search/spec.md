## ADDED Requirements

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
- **THEN** a notification offers continuation and a persistent header entry opens that exact repository and branch

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

Background completion SHALL provide a localized notification with a continuation action. Completion SHALL NOT navigate, steal focus, or install skills automatically. Continuation SHALL use current unsaved-draft navigation protection.

#### Scenario: Completion during other work

- **WHEN** a repository finishes while the user is on another page
- **THEN** that page remains active and the notification action can open the exact repository after any required discard confirmation

### Requirement: Repository reading remains usable during skill loading

Repository metadata, README reading and navigation SHALL remain usable while the skill list loads. README availability SHALL NOT determine task completion or block discovery. Installation SHALL continue to require the user's skill and agent choices.

#### Scenario: Read while loading

- **WHEN** skill discovery is still pending and README content is available
- **THEN** the user can read it and leave the page while discovery continues
