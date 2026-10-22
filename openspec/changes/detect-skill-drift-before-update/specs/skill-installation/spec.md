## ADDED Requirements

### Requirement: Update checks detect local modifications

When the update flow inspects a repo-installed skill, the system SHALL compare the installed skill folder's content hash with the `skillFolderHash` baseline stored in the lock entry, and SHALL report the skill as locally modified when they differ. Skills whose lock entry has no usable baseline hash SHALL NOT be reported as modified. The comparison SHALL NOT require any network request.

#### Scenario: Unmodified skill is not reported

- **WHEN** an installed skill folder matches its stored baseline hash
- **THEN** the update check does not report local modifications for that skill

#### Scenario: User edit is detected

- **WHEN** any regular file inside an installed skill folder differs from the content captured by the stored baseline hash
- **THEN** the update check reports that skill as locally modified

#### Scenario: Legacy entry without a baseline

- **WHEN** a lock entry has no `skillFolderHash` value or an empty one
- **THEN** the skill is not reported as locally modified and behaves as before this capability existed

### Requirement: Updates do not silently overwrite drifted skills

The system SHALL NOT apply an update to a skill reported as locally modified without an explicit user decision that local edits are lost. A single update of a drifted skill SHALL require explicit confirmation before overwriting. Batch updates SHALL skip drifted skills, SHALL report them in the completion summary, and SHALL offer an explicit per-skill action to update despite local modifications. Skills without a usable baseline keep the previous behavior and update without a drift prompt.

#### Scenario: Single update cancelled by default

- **WHEN** the user starts a single update for a locally modified skill and does not confirm the overwrite
- **THEN** no file inside the skill folder is changed and the stored baseline is unchanged

#### Scenario: Single update confirmed

- **WHEN** the user confirms overwriting local modifications on a single update
- **THEN** the update applies the repository content and the completion state reflects that local edits were replaced

#### Scenario: Batch update skips drifted skills

- **WHEN** a batch update includes locally modified skills alongside unmodified ones
- **THEN** unmodified skills update normally, drifted skills are skipped and listed in the summary as skipped due to local modifications, and each listed skill can still be updated explicitly afterwards

### Requirement: Successful content writes refresh the baseline

After a remote install completes, or after an update overwrites an installed skill's content, the system SHALL store a fresh content hash for that skill folder in its lock entry. A failed or rolled-back update SHALL NOT change the stored baseline.

#### Scenario: Install writes the baseline

- **WHEN** a remote install finishes writing the skill into the SSOT store
- **THEN** the new lock entry contains the content hash of the installed folder

#### Scenario: Successful update refreshes the baseline

- **WHEN** an update (including an overwrite confirmed by the user) finishes applying new content
- **THEN** the lock entry's stored hash matches the newly installed content

#### Scenario: Failed update keeps the baseline

- **WHEN** an update fails and the previously installed content is restored
- **THEN** the stored hash still describes the restored content and the skill is not reported as modified
