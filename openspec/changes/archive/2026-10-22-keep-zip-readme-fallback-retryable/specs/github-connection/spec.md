## MODIFIED Requirements

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

