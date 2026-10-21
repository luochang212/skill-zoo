## ADDED Requirements

### Requirement: Credential saves recover repository reads

After a verified credential is successfully saved, the desktop SHALL refresh active repository metadata, README and repository search queries and mark inactive queries stale for their next use. Obsolete in-flight results SHALL NOT overwrite recovered queries. Fresh disk caches SHALL remain reusable; stale fallbacks SHALL be eligible for a new network attempt. Failed saves SHALL NOT refresh queries. Saving SHALL NOT trigger install or update writes.

#### Scenario: Failed and degraded queries recover
- **WHEN** a valid token is saved after repository reads failed or returned stale or minimal data
- **THEN** active queries retry with the saved credential and inactive queries retry when next observed

#### Scenario: Valid cached metadata
- **WHEN** a valid token is saved while repository metadata is fresh on disk
- **THEN** the fresh disk cache can satisfy the refreshed query without a GitHub request

#### Scenario: Save fails
- **WHEN** token verification or credential persistence fails
- **THEN** repository queries and existing caches remain unchanged

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

## MODIFIED Requirements

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
