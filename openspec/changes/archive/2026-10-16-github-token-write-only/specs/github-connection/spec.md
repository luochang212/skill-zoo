# GitHub Connection Delta

## Purpose

Defines desktop authentication for public GitHub API reads, verified token settings, and actionable recovery from rate-limited skill update checks.

## RENAMED Requirements

- FROM: `### Requirement: Token removal and startup`
- TO: `### Requirement: Token replacement and startup`

## MODIFIED Requirements

### Requirement: Token replacement and startup

The desktop SHALL maintain at most one saved GitHub credential. Saving a new verified token SHALL replace the previous credential and its expiry in a single write, and the desktop SHALL NOT offer a credential removal action. Submitting an empty input SHALL NOT change the saved credential. A saved token SHALL supply authentication at startup while its recorded expiry has not passed and SHALL NOT be presented as freshly verified merely because it exists on disk.

#### Scenario: New token replaces the old
- **WHEN** a new token is verified and saved while a previous credential exists
- **THEN** the new token and its expiry replace the previous ones in a single write

#### Scenario: No new token entered
- **WHEN** the credential dialog is submitted without a new token (an empty field or an unchanged mask) while a token is saved
- **THEN** the saved token and its expiry remain unchanged

#### Scenario: Restart with configured token
- **WHEN** the desktop starts with a saved token
- **THEN** GitHub API reads use it and the settings section distinguishes configured from freshly verified status

#### Scenario: Failed credential save
- **WHEN** persisting a token and its expiry fails
- **THEN** persisted settings and runtime authentication both remain unchanged

## ADDED Requirements

### Requirement: Saved credential is never redisplayed

The settings UI SHALL NOT display the saved token or any part of it, and the generic settings read SHALL NOT include the credential keys. The dialog SHALL stand in for the saved token with a mask value carrying no information about the secret; while mask characters remain, the credential counts as unchanged and saving stays unavailable.

#### Scenario: Dialog with a saved token
- **WHEN** the credential dialog opens while a token is saved
- **THEN** the input holds the mask, never the token, and saving stays unavailable until the field actually changes

#### Scenario: Generic settings read omits credentials
- **WHEN** the generic settings read is invoked
- **THEN** the response contains neither `github_token` nor `github_token_expires_at`

#### Scenario: Mask behaves like content
- **WHEN** the user focuses, selects, deletes, or replaces the mask
- **THEN** the field behaves like ordinary text editing, with no automatic selection

#### Scenario: After a successful save
- **WHEN** a token is verified and saved
- **THEN** the input reverts to the mask and the status line shows the verified quota and recorded expiry

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
