## ADDED Requirements

### Requirement: CLI consistency respects external ownership and verified content

CLI consistency checks MUST exclude external imports from duplicate, conflict and name-mismatch reports. A same-name group MUST be classified as identical duplicates only when every member has the same nonempty content hash; missing hashes MUST result in conservative conflict classification. CLI installed-skill listing MUST continue to include valid external imports.

#### Scenario: External import shares a managed skill name
- **WHEN** an external import shares a managed skill's name and its frontmatter name differs from its directory
- **THEN** the external import contributes neither duplicate/conflict nor name-mismatch issues

#### Scenario: A duplicate candidate cannot be fully hashed
- **WHEN** two same-name skills are scanned and one content hash is unavailable
- **THEN** consistency reports a conflict rather than claiming their contents are identical
