## ADDED Requirements

### Requirement: Unsuccessful downloads clean up their temporary files

The system SHALL automatically attempt to remove a download's temporary file when downloading or cache publication returns an error, or the download future is dropped. An incomplete download SHALL NOT be published as the completed cache entry. Cleanup SHALL affect only the current download's temporary file.

#### Scenario: Response fails after partial data

- **WHEN** a successful HTTP response writes partial data and its body stream then fails
- **THEN** the operation fails, removes its temporary file, and publishes no incomplete cache entry

#### Scenario: Cache publication fails

- **WHEN** a complete response cannot be published at the cache destination
- **THEN** the operation fails and removes its temporary file

#### Scenario: Download is cancelled

- **WHEN** the download future is dropped after creating its temporary file
- **THEN** its temporary file is removed without affecting another in-flight download
