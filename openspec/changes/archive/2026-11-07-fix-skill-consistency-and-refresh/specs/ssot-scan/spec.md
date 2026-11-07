## ADDED Requirements

### Requirement: Scan paths agree on skill identity and metadata

Full and incremental scans of the same physical skill MUST agree on its identity, origin, directory, source metadata and frontmatter fallback. Existing legacy leaf-name lock lookup MUST behave consistently across those scans.

#### Scenario: Nested skill has a legacy lock entry
- **WHEN** a nested skill has a lock entry keyed by its leaf directory name
- **THEN** full and single-skill scans retain the same repository information

#### Scenario: Nested skill text cannot be decoded
- **WHEN** a nested skill's SKILL.md cannot be decoded as UTF-8
- **THEN** both scan paths use its leaf directory name without inventing a frontmatter mismatch

### Requirement: Refreshes preserve coherent derived state

Watcher incremental refresh and install/update refresh MUST serialize their scan-and-commit work with full rebuilds. An incremental batch MUST persist once, and persistence failure MUST leave its prior in-memory cache intact. Update commands MUST report refresh failure rather than silently returning an unqualified success; already updated skill files MUST remain intact.

#### Scenario: Refresh is already running
- **WHEN** a watcher or install/update refresh starts while another serialized refresh is active
- **THEN** it waits before scanning and committing, so the older refresh cannot overwrite its newer result

#### Scenario: Incremental cache persistence fails
- **WHEN** an incremental batch cannot persist the cache
- **THEN** the previous in-memory cache remains intact and the caller receives an error

#### Scenario: Updated files cannot be refreshed
- **WHEN** skill files update successfully but the subsequent cache refresh fails
- **THEN** the command and update history report the refresh failure without removing the updated source files
