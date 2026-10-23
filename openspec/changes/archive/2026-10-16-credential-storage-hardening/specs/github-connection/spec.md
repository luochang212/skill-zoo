# GitHub Connection Delta

## Purpose

Defines desktop authentication for public GitHub API reads, verified token settings, and actionable recovery from rate-limited skill update checks.

## ADDED Requirements

### Requirement: Credential keys have a single write path

The generic settings update command SHALL reject the GitHub credential keys `github_token` and `github_token_expires_at` with an actionable error. Credential changes SHALL only be applied through the credential save command, so the runtime authentication slot can never silently diverge from persisted credentials.

#### Scenario: Generic settings update rejects a credential key

- **WHEN** the generic settings update command is invoked with `github_token` or `github_token_expires_at`
- **THEN** the command fails with an error naming the credential save command and neither key's persisted value nor the runtime authentication changes

#### Scenario: Credential save command remains authoritative

- **WHEN** a credential is saved or removed through the credential save command
- **THEN** persisted settings and runtime authentication change together in one write

### Requirement: Credential-bearing files are owner-only

Credential-bearing files the desktop writes, namely `settings.json` and agent lifecycle journals, SHALL be written with owner-only file permissions (`0600`), independent of the process umask, on systems with unix file modes. Owner-only permissions SHALL apply to fresh writes and to writes that reuse a temp file left by an earlier failed write.

#### Scenario: Token saved lands owner-only

- **WHEN** a token is saved and settings are persisted on a unix system
- **THEN** `settings.json` has no group or other read permission regardless of umask

#### Scenario: Journal snapshot lands owner-only

- **WHEN** an agent lifecycle transaction journals `settings.json` content on a unix system
- **THEN** the journal file is written with no group or other read permission

#### Scenario: Failed write leaves a stale temp file

- **WHEN** a previous credential write crashed and left a temp file, and a new credential write reuses its path
- **THEN** the persisted file still ends up owner-only
