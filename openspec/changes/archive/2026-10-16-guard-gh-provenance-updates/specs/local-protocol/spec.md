## ADDED Requirements

### Requirement: Conservative provenance update authorization

Desktop remote updates MUST inspect the physical target using the provenance contract in docs/local-protocol.md and fixtures/local-protocol/. Tracking or unreadable targets MUST be refused before remote work. Local issues MUST precede pin, baseline and source issues. Normal files without reserved metadata MUST remain updatable.

#### Scenario: Reserved tracking or unsafe YAML
- **WHEN** any reserved metadata key exists, or frontmatter cannot be safely read and interpreted
- **THEN** updates and Check report ghProvenanceProtected or skillProvenanceUnreadable respectively, with no remote work for that item and no selectable candidate

#### Scenario: Ordinary Skill Zoo installation
- **WHEN** a valid target has ordinary metadata or only body/root-level github examples
- **THEN** a confirmed remote update replaces the target and writes its normal dual baseline

### Requirement: Refused update preservation

Refused updates MUST preserve target directory bytes and symlink destinations. Single-item and wholly refused batches MUST preserve lock bytes; mixed batches MUST preserve refused entries semantically, including unknown fields. Observed target identity or SKILL.md byte changes during checking/download MUST report updateStateChanged before replacement and preserve the external state.

#### Scenario: Mixed batch
- **WHEN** a batch contains a protected item and an ordinary updatable item
- **THEN** the ordinary item updates, the protected item and its original lock entry remain unchanged, and counts/history report the per-item outcomes

#### Scenario: External edit while downloading
- **WHEN** SKILL.md or target identity changes after authorization and before final replacement
- **THEN** the update is refused with updateStateChanged, and the observed external files and lock remain untouched

### Requirement: CLI preserves provenance within its lifecycle boundary

CLI scan, archive and restore MUST preserve original SKILL.md bytes, including reserved metadata. Shared desktop fixtures MUST exercise real filesystem operations. The CLI MUST NOT claim a remote update implementation or create a separate provenance schema.

#### Scenario: Tracking installation archived and restored
- **WHEN** the CLI scans, archives and restores the shared gh-injected fixture
- **THEN** SKILL.md retains its original bytes and lock entry fields are preserved
