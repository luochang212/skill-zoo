## ADDED Requirements

### Requirement: skillFolderHash records the installed content baseline

The `skillFolderHash` field of a lock entry SHALL hold the desktop's content baseline for an installed skill folder, with the canonical definition, write points and unknown-baseline rule documented in `docs/local-protocol.md` and exercised by `fixtures/local-protocol/`. The desktop SHALL write the field when it installs or updates a repo-backed skill.

#### Scenario: Fixture parity

- **WHEN** the desktop parses the shared lock fixtures containing a populated `skillFolderHash`
- **THEN** it treats the value as a usable baseline for drift comparison

#### Scenario: Same content, same baseline

- **WHEN** the same skill folder content is hashed twice
- **THEN** the recorded baseline value is identical, and renaming or editing any regular file changes it

#### Scenario: Baseline is written on content writes

- **WHEN** the desktop installs or updates a repo-backed skill
- **THEN** the entry's stored value describes the newly written folder content

### Requirement: Unknown baselines are tolerated by both surfaces

A lock entry with no `skillFolderHash` or an empty string SHALL be read as an unknown baseline, not a mismatch. The desktop SHALL NOT report drift for such entries and SHALL populate the field on the next install or update write. The CLI SHALL read and preserve the value without interpreting it, and neither surface SHALL fail to read the lock.

#### Scenario: Legacy empty value

- **WHEN** a lock entry carries no `skillFolderHash` or an empty string, as produced by older writers
- **THEN** both surfaces accept the entry and the desktop does not claim the skill is locally modified

#### Scenario: CLI preserves without interpreting

- **WHEN** the CLI reads and rewrites lock state containing a populated `skillFolderHash`
- **THEN** the value passes through unchanged
