## ADDED Requirements

### Requirement: Archive lock snapshots belong to their physical SSOT installation

Agent archives MUST NOT snapshot, remove or replace an independent SSOT installation's lock record, including through historical agent lock snapshots. Existing records remain readable in the existing formats; ordinary failure recovery MUST preserve the prior lock state. Historical restore boundaries MUST be documented and covered by shared Rust/CLI fixtures.

#### Scenario: Independent same-name installations
- **WHEN** an agent-native skill shares its relative directory with a tracked SSOT installation
- **THEN** archiving/restoring the agent skill leaves the SSOT lock entry and unknown optional fields intact

#### Scenario: Shared compatibility coverage
- **WHEN** desktop or CLI archive compatibility changes
- **THEN** docs/local-protocol.md and both archive-roundtrip-cases.json and archive-unsupported-cases.json under fixtures/local-protocol/ describe and exercise the same boundaries
