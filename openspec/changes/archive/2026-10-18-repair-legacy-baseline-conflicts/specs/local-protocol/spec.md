# Spec Delta

## MODIFIED Requirements

### Requirement: Update baselines follow the documented carrier read order

Update checks MUST derive a skill's content baseline according to docs/local-protocol.md, which defines the precedence between the recorded tree-SHA carrier and its legacy mirror. An entry with no recorded baseline MUST be presented as an explicit needs-re-confirmation state and MUST NOT be reported as up to date. When the two carriers disagree, the verified-resolution path in docs/local-protocol.md applies: align both to the locally verified content, or keep the explicit conflict state.

#### Scenario: Baseline survives an external rewrite

- **WHEN** an external writer strips the mirror field but the carrier remains, and the user checks updates
- **THEN** the skill is compared against its recorded baseline normally and no baseline rewrite happens

#### Scenario: No recorded baseline

- **WHEN** an entry has neither carrier field recorded, and the user checks updates
- **THEN** the skill is not reported as up to date for that check and is surfaced in an explicit needs-re-confirmation state with its known source

#### Scenario: Missing explicit ref

- **WHEN** a lock entry has no explicit `ref` recorded
- **THEN** it continues to follow the repository default branch per docs/local-protocol.md and no branch is guessed on its behalf

#### Scenario: Legacy conflict resolved by verified local content

- **WHEN** an entry's carriers disagree, but the installed directory's content tree SHA equals one of the two recorded values (a legacy entry written once by an external tool and once by a pre-dual-baseline app update), and the user checks updates
- **THEN** both carrier fields are aligned to the locally verified value, the entry is evaluated as unconflicted against the remote, and no other entry field is altered

#### Scenario: Conflict survives when content cannot be attributed

- **WHEN** an entry's carriers disagree and the installed directory is missing, or its content tree SHA matches neither recorded carrier
- **THEN** the entry stays in the explicit conflict state requiring user decision, and no carrier field is rewritten

### Requirement: Update checks never write baselines

The checker MUST NOT write or modify any skill's baseline, except for the verified-conflict alignment in docs/local-protocol.md: a value already recorded in the entry and verified against installed content. It MUST NOT write a network-time, remote-tip, or guessed value. Otherwise baselines are written only by install, update, or the documented external-repair procedure. An entry with no recorded baseline keeps its explicit needs-re-confirmation state, however often it is checked.

#### Scenario: A check never invents a baseline

- **WHEN** an entry has no recorded baseline and a successful update check fetches the remote tree
- **THEN** the check reports the needs-re-confirmation state and writes no baseline, so any masked pending update stays visible

#### Scenario: Repeated checks do not converge to up to date

- **WHEN** the same entry with no recorded baseline is checked more than once
- **THEN** every check reports the needs-re-confirmation state and no baseline is written

#### Scenario: Externally pinned entries are never baselined by a check

- **WHEN** an externally pinned entry has no recorded baseline and the user checks updates
- **THEN** the check reports the pinned state and writes nothing

#### Scenario: Verified alignment writes only a recorded value

- **WHEN** a check resolves a conflicted entry whose local content matches exactly one recorded carrier
- **THEN** the only baseline write is the alignment of the other carrier to that same verified value, and no remote or network-derived value is written for any entry

#### Scenario: Resolution is idempotent

- **WHEN** an aligned entry is checked again while its carriers agree
- **THEN** the check makes no further baseline write and evaluates the entry like any unconflicted skill, whose baseline remains the point-in-time fact recorded at resolution

### Requirement: Conflicting or incomplete provenance is surfaced

When an entry's baseline carriers disagree, or its source attribution is missing or unparseable, the app MUST present an explicit state requiring user decision. It MUST NOT silently pick one of the conflicting values, silently perform an update, or silently drop the skill from update status. The one exception is the verified-conflict resolution in docs/local-protocol.md: a measurement of installed content, never a silent choice.

#### Scenario: Disagreeing baseline carriers

- **WHEN** an entry's carrier field and mirror field hold different tree SHAs, its installed content matches neither of them, and the user checks updates
- **THEN** the skill is shown in an explicit conflict state and no update is fetched or performed for it

#### Scenario: Disagreeing carriers resolved by verified content no longer block updates

- **WHEN** an entry's carriers disagree, the installed content's tree SHA equals exactly one of them, and the user checks updates or requests an update for that skill
- **THEN** the carriers are aligned to the verified value and the skill participates in the check or update like any unconflicted entry

#### Scenario: Pinned conflict is never aligned

- **WHEN** an externally pinned entry's carriers disagree, even if the installed content's tree SHA matches one of them
- **THEN** the entry keeps its recorded carrier fields and the explicit pinned/conflict state, and no alignment is written

#### Scenario: Disagreeing carriers without verifiable content still block updates

- **WHEN** an entry's carriers disagree and the installed content's tree SHA matches neither of them, and the user requests an update for that skill
- **THEN** the update is refused with the explicit conflict state and the installed files, symlink destinations, and raw lock bytes are left unchanged

#### Scenario: Incomplete attribution stays visible

- **WHEN** an entry's source attribution is missing or cannot be parsed
- **THEN** the skill remains present in update status with an explicit state rather than disappearing from the results

### Requirement: Refused update preservation

Refused updates MUST preserve target bytes and symlink destinations. Single-item and wholly refused batches MUST preserve lock bytes, except for an applied verified-conflict alignment (an independent write not undone by a refusal). Mixed batches MUST preserve refused entries semantically, including unknown fields, except that alignment. Observed target identity or SKILL.md byte changes during checking/download MUST report updateStateChanged before replacement and preserve the external state.

#### Scenario: Refusal does not undo an applied alignment

- **WHEN** a single or checked update aligns a verified conflict and the update is then refused (for example updateStateChanged)
- **THEN** target bytes and symlink destinations stay unchanged, the alignment remains recorded in the lock, and the skill is reported with the refusal state

#### Scenario: Mixed batch

- **WHEN** a batch contains a protected item and an ordinary updatable item
- **THEN** the ordinary item updates, the protected item and its original lock entry remain unchanged, and counts/history report the per-item outcomes

#### Scenario: External edit while downloading

- **WHEN** SKILL.md or target identity changes after authorization and before final replacement
- **THEN** the update is refused with updateStateChanged; the observed external files remain untouched, and any verified-conflict alignment already applied stays recorded
