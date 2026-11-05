## MODIFIED Requirements

### Requirement: Collection robustness
The system SHALL skip undecodable records and missing stores without failing collection: an invalid line in a session file MUST NOT drop surrounding valid events, a session file that fails to decompress MUST be skipped without failing collection, and a missing session directory or database SHALL yield empty usage rather than an error. Inaccessible stores and database connection or query failures SHALL be reported as errors instead of zero usage.

#### Scenario: Invalid line between valid lines
- **WHEN** a session file contains a non-JSON line between two valid skill-invocation lines
- **THEN** both valid events are still collected

#### Scenario: Compressed session file fails to decompress
- **WHEN** a compressed session file cannot be decompressed
- **THEN** that file is skipped and collection continues with the remaining files

#### Scenario: Store does not exist
- **WHEN** an agent's session directory or database is absent
- **THEN** collection returns empty usage for that agent without an error

#### Scenario: Store exists but cannot be read
- **WHEN** directory or file access fails, or the SQLite store cannot be opened or queried
- **THEN** collection reports a read error rather than successful empty usage


## ADDED Requirements

### Requirement: Shared selected usage agent
Usage Habits and the tray's Recently Used menu SHALL use the same saved usage-agent setting, preferring Codex when the saved selection is unavailable, then the first available tracked agent. Selection changes SHALL become visible after successful persistence; failed saves SHALL retain the previous selection and show an error. A valid selected agent with empty or unreadable usage SHALL NOT fall back to another agent.

#### Scenario: Select ZCode
- **WHEN** the user selects ZCode and saving succeeds
- **THEN** the dialog and tray read ZCode, and the tray title identifies ZCode

#### Scenario: Selection save fails
- **WHEN** saving a new selection fails
- **THEN** both consumers retain the prior selection and the dialog reports the failure

### Requirement: Shared per-agent usage snapshots
The dialog and tray SHALL share a per-agent usage cache with a 30-second freshness window and coalesce concurrent scans, including concurrent failed scans. Different agents SHALL scan independently. Refresh failure SHALL preserve only that agent's previous successful result with an error; a subsequent retry SHALL be possible. A late result SHALL NOT overwrite another selected agent's view.

#### Scenario: Dialog and tray refresh together
- **WHEN** both request stale data for the same agent concurrently
- **THEN** one scan supplies both requests

#### Scenario: Switch while an old scan runs
- **WHEN** ZCode is selected while another agent is being scanned
- **THEN** ZCode loads independently; the old scan updates only its own cache

#### Scenario: Refresh failure after success
- **WHEN** a refresh fails after that agent had a successful result
- **THEN** its prior result remains available with an error and retry can recover

### Requirement: Recent usage presentation and refresh
Recently Used SHALL distinguish initial loading, successful records, successful empty usage, and read failure, and SHALL label the source agent. Results SHALL remain time-ordered, deduplicated by skill, and limited to five. It SHALL offer retry after failure and retain same-agent old results during refresh.

#### Scenario: Fresh agent has no result yet
- **WHEN** switching to an agent with no cached result
- **THEN** loading is displayed without another agent's records

#### Scenario: Missing versus unreadable store
- **WHEN** the selected store is absent or unreadable
- **THEN** absence produces an empty state, while read failure produces an error and retry

### Requirement: Usage refresh checks
Supported tray events SHALL check freshness. A serial background check separated by 30 seconds after completion SHALL cover platforms without events. Usage Habits SHALL check while open. Refresh SHALL only scan the requested agent, reuse fresh cached results, and SHALL NOT promise realtime updates.

#### Scenario: No tray mouse event support
- **WHEN** the platform does not emit tray mouse events
- **THEN** the background freshness check keeps snapshots available for subsequent menu openings
