## ADDED Requirements

### Requirement: Archive mutations coordinate with other local writers and refreshes

Archive and restore MUST acquire the shared local writer lease and serialize their scan-and-mutation work against cache rebuilds. Waiting or cancelled operations MUST NOT leave a writer lease held. Existing update-exit protection MUST cover the entire operation.

#### Scenario: A cache refresh is active
- **WHEN** an archive or restore begins while a serialized refresh is active
- **THEN** it waits before changing files and stores

#### Scenario: A waiting operation is cancelled
- **WHEN** an operation is cancelled while waiting for refresh coordination
- **THEN** its local writer lease is released without moving files

### Requirement: Restore preserves the selected physical skill identity

Archive and restore MUST operate on the selected skill's recorded physical home and ownership. A same-name skill at another home MUST NOT replace its identity or have its files, metadata or SSOT provenance consumed by that operation. Historical IDs and retained imports MUST remain supported under the local protocol.

#### Scenario: An agent skill has the same directory as an SSOT installation
- **WHEN** that agent skill is archived and restored
- **THEN** it returns to its agent home with its own identity and user flags, and the independent SSOT installation and lock entry remain unchanged

### Requirement: Unsupported historical ownership is rejected without destructive migration

Restore MUST accept only SSOT and agent-owned archive records. External/plugin/unknown historical ownership and agent records without their original home MUST be rejected before moving files, retaining their records and archived/source files for inspection and manual recovery. Historical agent lock snapshots MUST NOT be applied to SSOT. Deterministic canonical-SSOT fallback and existing metadata-ID migration MAY remain supported.

#### Scenario: An old external record contains archived files
- **WHEN** restore receives that record
- **THEN** it reports unsupported ownership and does not delete its archive directory or original source

#### Scenario: An agent record lacks its original home
- **WHEN** restore receives that record
- **THEN** it reports the missing original destination and retains the archive instead of guessing a current agent or SSOT directory

### Requirement: Failed lifecycle operations recover the complete prior store state

Ordinary archive/restore failure MUST attempt recovery of the prior cache, metadata, manifest and installation lock, in addition to the operation's moved files and links. Recovery MUST release individual state locks before reacquiring them. If recovery is incomplete, the failure MUST disclose that condition. This requirement does not establish process-crash or power-loss atomicity.

#### Scenario: Restore fails after temporarily replacing a lock record
- **WHEN** restore writes a lock record and a later step fails
- **THEN** recovery reinstates the prior lock record rather than deleting it by key

#### Scenario: Recovery cannot persist a store
- **WHEN** an operation fails and a recovery save also fails
- **THEN** the operation reports both the original failure and the incomplete recovery
