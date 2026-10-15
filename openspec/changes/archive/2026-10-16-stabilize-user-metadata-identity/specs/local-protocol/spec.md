## ADDED Requirements

### Requirement: Stable user metadata identity

Desktop and CLI MUST address SSOT user flags by installation-relative directory according to docs/local-protocol.md, independently of provenance and cache IDs. Other origins MUST retain their existing IDs. All metadata lifecycle operations MUST use the same rule.

#### Scenario: Provenance changes without moving the slot
- **WHEN** a marked SSOT skill changes to another valid source, a malformed source, or has its lock removed and cache rebuilt
- **THEN** starred and isMine remain associated with the same installation directory on both surfaces

#### Scenario: Historical archive restored
- **WHEN** an archive with a historical repo originalSkillId is restored
- **THEN** its flag snapshot is written using the restored origin and directory, without changing the historical archive format

### Requirement: Conservative versioned metadata migration

Desktop and CLI MUST migrate legacy metadata once under the shared mutation lease using filesystem directory evidence, preserve ambiguous or unparseable records, and refuse future-version writes. Migration MUST NOT OR flags, overwrite conflicting values, consume imports' identities, or depend on cache data. Shared metadata fixtures MUST verify these semantics.

#### Scenario: Unambiguous legacy records
- **WHEN** a legacy candidate or equal candidates identify an existing SSOT slot without conflicting target flags
- **THEN** one atomic v1 save moves the records to its stable key and repeated reads do not migrate again

#### Scenario: Conflicting or unbound metadata
- **WHEN** candidates disagree, the target disagrees, a retained import owns the ID, or attribution lacks safe directory evidence
- **THEN** original entries remain intact and unbound candidates are reported for explicit manual assignment or discard

#### Scenario: Future metadata version
- **WHEN** a metadata mutation encounters a version above v1
- **THEN** the operation fails with an upgrade message and preserves the original bytes
