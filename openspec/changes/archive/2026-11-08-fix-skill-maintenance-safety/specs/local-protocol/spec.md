## ADDED Requirements

### Requirement: Unknown installed versions are not inferred from remote state

Under docs/local-protocol.md, a missing commitSha SHALL remain an unknown installed version until a content install or explicit update establishes its baseline. Desktop checks SHALL report an unknown-version issue instead of writing today's remote SHA. Rust and CLI SHALL preserve this state when reading and rewriting shared fixtures/local-protocol/ data, independently of whether a local content hash is present.

#### Scenario: Unknown version with a known local content hash
- **WHEN** either surface reads and rewrites lock-v3-unknown-version.json
- **THEN** commitSha remains unknown and the local content baseline is preserved

#### Scenario: Check an unknown version
- **WHEN** desktop update checking finds a remote version for an entry without commitSha
- **THEN** it reports a missing-baseline issue without modifying that entry or asserting it is current
