# github-connection Specification

## Purpose

Defines desktop authentication for public GitHub API reads, verified token settings, and actionable recovery from rate-limited skill update checks.

## Requirements

### Requirement: Verified token settings

The desktop SHALL accept a trimmed personal access token, verify it against GitHub's rate-limit endpoint before saving, and display the authenticated hourly core quota. Invalid credentials, network errors, unexpected responses, and persistence failures SHALL NOT replace an existing saved token, its persisted expiry, or its runtime authentication. A successful save SHALL persist the token and its expiry in a single settings write.

#### Scenario: Valid token saved
- **WHEN** the rate-limit endpoint returns HTTP 200 with core limit 5000 for the submitted token
- **THEN** saving persists the trimmed token and displays its effective quota
- **AND** subsequent requests use it immediately without restarting

#### Scenario: Invalid token rejected
- **WHEN** verification returns HTTP 401 or an anonymous core limit of 60
- **THEN** verification fails and the existing saved token remains unchanged

#### Scenario: Verification or save unavailable
- **WHEN** verification fails due to transport, unexpected HTTP status or malformed data, or settings cannot be persisted
- **THEN** an actionable failure is shown and saved/runtime authentication remains unchanged

### Requirement: Token replacement and startup

The desktop SHALL maintain one saved GitHub credential. Saving a verified replacement SHALL update token and expiry atomically. Explicitly saving an empty field SHALL remove both and restore anonymous runtime authentication; closing without saving SHALL preserve them. A saved token SHALL authenticate requests at startup until its recorded expiry, without being presented as freshly verified merely because it exists on disk.

#### Scenario: New token replaces the old
- **WHEN** a new token is verified and saved while a previous credential exists
- **THEN** the new token and its expiry replace the previous ones in a single write

#### Scenario: No new token entered
- **WHEN** the credential dialog is submitted while a token is saved and the token field is unchanged
- **THEN** the saved token and its expiry remain unchanged

#### Scenario: Restart with configured token
- **WHEN** the desktop starts with a saved token
- **THEN** GitHub API reads use it and the settings section distinguishes configured from freshly verified status

#### Scenario: Failed credential save
- **WHEN** persisting a token and its expiry fails
- **THEN** persisted settings and runtime authentication both remain unchanged

### Requirement: Saved credential can be viewed and edited

The dialog SHALL load the real saved token through a dedicated Rust IPC command when opened. The generic settings read SHALL continue to omit credential keys. The input SHALL default to password masking using the real value, with an eye button to show or hide it. Fixed-length stand-in masks SHALL NOT be used. Reading, toggling visibility, and editing SHALL NOT save credentials. The unchanged value SHALL leave saving unavailable. Loading or failed token reads SHALL disable editing and saving.

#### Scenario: View a saved token
- **WHEN** the dialog opens with a saved token and the user toggles the eye button
- **THEN** the real token is shown or hidden without modifying or saving it

#### Scenario: Clear a saved token
- **WHEN** the user empties the field using text editing or the clear icon and explicitly saves
- **THEN** the token and expiry are removed together without verification and runtime authentication returns to anonymous mode

#### Scenario: Cancel editing
- **WHEN** the user edits or clears the token and closes the dialog without saving
- **THEN** the saved credential remains unchanged and reopening shows the saved value hidden

#### Scenario: Save replacement
- **WHEN** a changed nonempty token is verified and saved
- **THEN** the real saved value remains in the password input and the status shows the verified quota and expiry

### Requirement: Dialog verifies the saved credential

While a token is saved, opening the credential dialog SHALL verify it against GitHub's rate-limit endpoint through a command that reads the credential server-side, and SHALL display the verified quota. A check that reports the credential unauthenticated SHALL mark it no longer valid without altering the saved credential. A transport failure during this check SHALL leave the saved-state display unchanged.

#### Scenario: Dialog opens with a saved token
- **WHEN** the credential dialog opens while a token is saved
- **THEN** the saved token is verified without crossing the bridge and the dialog shows the verified quota

#### Scenario: Saved token no longer valid
- **WHEN** the verification reports the credential unauthenticated
- **THEN** the dialog marks the token no longer valid and the saved credential remains unchanged

#### Scenario: Live check unavailable
- **WHEN** the verification cannot reach GitHub
- **THEN** the dialog keeps the saved-state display and the saved credential remains unchanged

### Requirement: Credential keys have a single write path

The generic settings update command SHALL reject the GitHub credential keys `github_token` and `github_token_expires_at` with an actionable error. Credential changes SHALL only be applied through the credential save command, so the runtime authentication slot can never silently diverge from persisted credentials.

#### Scenario: Generic settings update rejects a credential key
- **WHEN** the generic settings update command is invoked with `github_token` or `github_token_expires_at`
- **THEN** the command fails with an error naming the credential save command and neither key's persisted value nor the runtime authentication changes

#### Scenario: Credential save command remains authoritative
- **WHEN** a credential is saved or removed through the credential save command
- **THEN** persisted settings and runtime authentication change together in one write

### Requirement: Credential-bearing files are owner-only

The desktop writes two files that carry credential content, `settings.json` and the agent lifecycle journals. Both SHALL be written with owner-only file permissions (`0600`), independent of the process umask, on systems with unix file modes. Owner-only permissions SHALL apply to fresh writes and to writes that reuse a temp file left by an earlier failed write.

#### Scenario: Token saved lands owner-only
- **WHEN** a token is saved and settings are persisted on a unix system
- **THEN** `settings.json` has no group or other read permission regardless of umask

#### Scenario: Journal snapshot lands owner-only
- **WHEN** an agent lifecycle transaction journals `settings.json` content on a unix system
- **THEN** the journal file is written with no group or other read permission

#### Scenario: Failed write leaves a stale temp file
- **WHEN** a previous credential write crashed and left a temp file, and a new credential write reuses its path
- **THEN** the persisted file still ends up owner-only

### Requirement: Authentication covers public API reads

Desktop tree, repository metadata, and README API reads (including explicit branch reads) SHALL attach `Authorization: Bearer <token>` when configured and omit it otherwise. Authentication SHALL NOT be added to unrelated downloads or external URLs. Existing request timeouts and consumer fallback behavior SHALL be preserved.

#### Scenario: Configured token used across consumers
- **WHEN** update checks, discovery metadata or README requests are built with a saved token
- **THEN** each GitHub API request carries the token

#### Scenario: Anonymous operation
- **WHEN** no token is configured
- **THEN** the same API reads omit Authorization

### Requirement: Forbidden responses do not poison update batches

For tree API responses the desktop SHALL classify HTTP 403 as rate limiting only when `X-RateLimit-Remaining` is exactly `0`. HTTP 429 SHALL remain rate limiting. Other HTTP 403 responses SHALL fail only the affected repository as temporarily unavailable, or as a permission failure when explicit GitHub permission or SSO headers are present, and SHALL NOT stop checking the remaining repositories.

#### Scenario: Primary quota exhausted
- **WHEN** a tree response is HTTP 403 with remaining quota zero
- **THEN** checking stops with rate-limited diagnostics

#### Scenario: Proxy forbidden response
- **WHEN** a tree response is HTTP 403 with missing or nonzero remaining quota and no explicit permission or SSO headers
- **THEN** the repository receives a temporary failure and the batch continues

#### Scenario: Too many requests
- **WHEN** a tree response is HTTP 429
- **THEN** checking stops with rate-limited diagnostics

#### Scenario: Explicit forbidden response
- **WHEN** a tree response is HTTP 403 with permission or SSO headers and no exhausted quota
- **THEN** the repository receives a permission failure and the batch continues

### Requirement: Public-only setup and recovery guidance

The English and Chinese settings UI SHALL provide a masked, labeled token input, save action and GitHub fine-grained token creation link through the desktop opener. Instructions SHALL specify Public Repositories access and no repository permissions, explaining that this token cannot access private repositories. Update items SHALL offer token settings only for invalid credentials or anonymous quota exhaustion; authenticated quota exhaustion SHALL show the recovery time instead.

#### Scenario: Create a public-only token
- **WHEN** the user follows the GitHub connection instructions
- **THEN** they can open GitHub's creation page, select Public Repositories with no permissions, and paste the generated token

#### Scenario: Recover from anonymous update rate limiting
- **WHEN** the user selects Configure GitHub Token beside an anonymously rate-limited update item
- **THEN** the update manager closes and the token settings input becomes reachable and focused

#### Scenario: Authenticated quota does not offer token setup
- **WHEN** an update item reports authenticated quota exhaustion
- **THEN** it shows the recovery time without a Configure GitHub Token entry

### Requirement: Expired token falls back to anonymous quota

A saved token whose recorded expiry has passed SHALL NOT be attached to GitHub API reads; requests SHALL use the anonymous quota while the settings row continues to display the expired state. Tokens with no recorded expiry or an unparseable expiry value SHALL remain attached so invalid credentials still fail loudly.

#### Scenario: Recorded expiry has passed
- **WHEN** a saved token's recorded expiry is in the past
- **THEN** GitHub API reads omit the Authorization header and the settings row shows the token as expired

#### Scenario: Expiry in the future
- **WHEN** a saved token's recorded expiry is in the future
- **THEN** GitHub API reads attach it

#### Scenario: Expiry unknown or unreadable
- **WHEN** a saved token has no expiry or an unparseable expiry value
- **THEN** GitHub API reads still attach it

### Requirement: GitHub connection status row

The GitHub connection settings row SHALL derive its status line from persisted settings and the latest verification: the anonymous hourly quota when no token is saved, a configured state for a saved token that has not been freshly verified, and the effective hourly quota and recorded expiry after a successful save-time verification. The status line SHALL use the warning color once the recorded expiry has passed or falls within seven days.

#### Scenario: Settings still loading
- **WHEN** the settings section mounts and settings have not loaded yet
- **THEN** the row shows a loading state

#### Scenario: Settings cannot be loaded
- **WHEN** loading settings fails
- **THEN** the row shows a load-failure state instead of an empty or stale status

#### Scenario: No token saved
- **WHEN** the settings section loads without a saved token
- **THEN** the row shows the anonymous hourly quota instead of a configured state

#### Scenario: Saved token without fresh verification
- **WHEN** a token is saved and has not been verified in this session
- **THEN** the row shows the configured state and does not claim a verified quota

#### Scenario: Freshly verified token
- **WHEN** verification succeeds while saving a token
- **THEN** the row shows the effective hourly quota and the recorded expiry

#### Scenario: Expiry approaching or passed
- **WHEN** the recorded expiry falls within seven days or has passed
- **THEN** the status line uses the warning color, and an expired token additionally shows the expired state while requests fall back to the anonymous quota

### Requirement: Credential saves recover repository reads

After a verified credential is successfully saved, the desktop SHALL refresh active repository metadata, README and repository search queries and mark inactive queries stale for their next use. Obsolete in-flight results SHALL NOT overwrite recovered queries. Fresh API caches SHALL remain reusable; stale and ZIP fallbacks SHALL allow another network attempt. Failed saves SHALL NOT refresh queries. Saving SHALL NOT trigger install or update writes.

#### Scenario: Failed and degraded queries recover
- **WHEN** a valid token is saved after repository reads failed or returned stale or minimal data
- **THEN** active queries retry with the saved credential and inactive queries retry when next observed

#### Scenario: Valid cached metadata
- **WHEN** a valid token is saved while repository metadata is fresh on disk
- **THEN** the fresh disk cache can satisfy the refreshed query without a GitHub request

#### Scenario: Save fails
- **WHEN** token verification or credential persistence fails
- **THEN** repository queries and existing caches remain unchanged

#### Scenario: ZIP fallback after an API failure
- **WHEN** a README API request fails and content is recovered from a cached ZIP
- **THEN** that content remains available offline without acquiring a fresh API cache lifetime

#### Scenario: Credential recovery after ZIP fallback
- **WHEN** a valid token is saved after a README was recovered from ZIP
- **THEN** the next invalidated README read retries GitHub, and still returns fallback content if GitHub remains unavailable

### Requirement: Actionable GitHub API failures

Tree, metadata and README reads SHALL distinguish invalid credentials, quota exhaustion, explicit GitHub permission failures, missing repositories and transport failures. Quota errors SHALL carry effective authentication and a usable retry timestamp when available. English and Chinese displays SHALL provide actionable guidance. Existing stale-cache and README ZIP fallbacks SHALL remain. Repository API queries SHALL NOT automatically retry failures. Update issues SHALL preserve recovery details.

#### Scenario: Anonymous quota exhausted
- **WHEN** an API response reports exhausted anonymous quota
- **THEN** the user is guided to configure a GitHub token and shown a recovery time when available

#### Scenario: Authenticated quota exhausted
- **WHEN** an API response reports exhausted authenticated quota
- **THEN** the user is guided to wait until the recovery time when available rather than being told authentication will fix it; Retry-After takes precedence over X-RateLimit-Reset

#### Scenario: Saved credentials do not start writes
- **WHEN** a verified token is saved
- **THEN** no installation or skill update write is started

#### Scenario: Missing README
- **WHEN** the README endpoint returns 404 and no cached README exists
- **THEN** the README remains absent rather than claiming that the repository itself is missing

#### Scenario: Invalid token
- **WHEN** a GitHub API read returns HTTP 401
- **THEN** the user is guided to replace the saved token without silently removing it

#### Scenario: Explicit permission failure
- **WHEN** a forbidden API response includes GitHub permission or SSO requirement headers
- **THEN** the error explains the access restriction without stopping other repositories

#### Scenario: Unclassified forbidden response
- **WHEN** an API response is HTTP 403 without exhausted quota or explicit permission headers
- **THEN** the error remains temporarily unavailable and checking continues
