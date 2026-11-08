## ADDED Requirements

### Requirement: Remote baselines describe the downloaded snapshot

The desktop SHALL establish remote version baselines from the downloaded archive's identified commit, rather than a later mutable branch lookup. An update whose downloaded folder version differs from its checked candidate SHALL fail before replacing that skill and require a fresh check. Missing archive identity or failed snapshot lookup SHALL prevent updates; installation SHALL remain possible with an unknown remote baseline.

#### Scenario: Branch advances after checking
- **WHEN** an update checked folder version A but downloads version B
- **THEN** that skill remains unchanged, its lock baseline stays unchanged, and the result requests another check

#### Scenario: Install uses an older cached archive
- **WHEN** installation extracts a cached commit A and the branch now points to B
- **THEN** its remote baseline is derived from A, or remains unknown if A cannot be queried, and is never inferred from B

#### Scenario: Archive identity is unavailable
- **WHEN** the downloaded ZIP has no usable commit identity
- **THEN** an update preserves installed content and reports an error, while a new installation records no remote version baseline

### Requirement: Updated content and lock publication roll back together

Each updated skill SHALL retain its prior directory until its lock baseline has been successfully published. Lock publication failure SHALL restore prior content and preserve its prior baseline; incomplete recovery SHALL report the retained backup location. Successfully committed sibling updates SHALL remain successful. This requirement does not promise process-crash or power-loss atomicity.

#### Scenario: Lock publication fails after directory replacement
- **WHEN** replacement content has been staged but its lock file cannot be published
- **THEN** that skill reports failure, the prior directory is restored and the prior lock baseline remains unchanged
