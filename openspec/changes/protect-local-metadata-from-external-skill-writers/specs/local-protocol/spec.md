## ADDED Requirements

### Requirement: Lossless roundtrip of fields the app does not declare

Desktop and CLI MUST preserve shared-lock fields that their own schema does not declare across every read-modify-write of `~/.agents/.skill-lock.json`. Rewriting the lock MUST NOT drop or alter such fields of entries the operation does not intentionally modify. Declared carrier semantics are defined in docs/local-protocol.md.

#### Scenario: External extension survives an unrelated desktop rewrite

- **WHEN** the lock contains an entry carrying `pinnedRef` and other unknown fields, and the desktop updates an unrelated entry
- **THEN** the external fields are written back unchanged

#### Scenario: Fixture parity across both surfaces

- **WHEN** desktop and CLI each read and rewrite the shared gh-shaped lock fixture
- **THEN** unknown entry-level and top-level fields survive intact on both surfaces

### Requirement: Update baselines follow the documented carrier read order

Update checks MUST derive a skill's content baseline according to docs/local-protocol.md, which defines the precedence between the recorded tree-SHA carrier and its legacy mirror. An entry with no recorded baseline MUST be presented as an explicit needs-re-confirmation state and MUST NOT be reported as up to date.

#### Scenario: Baseline survives an external rewrite

- **WHEN** an external writer strips the mirror field but the carrier remains, and the user checks updates
- **THEN** the skill is compared against its recorded baseline normally and no baseline rewrite happens

#### Scenario: No recorded baseline

- **WHEN** an entry has neither carrier field recorded, and the user checks updates
- **THEN** the skill is not reported as up to date for that check and is surfaced in an explicit needs-re-confirmation state with its known source

#### Scenario: Missing explicit ref

- **WHEN** a lock entry has no explicit `ref` recorded
- **THEN** it continues to follow the repository default branch per docs/local-protocol.md and no branch is guessed on its behalf

### Requirement: Baseline establishment is gated on fresh installs within the self-heal window

The checker MUST write the remote latest revision as a baseline only for an entry that never recorded one and whose install time falls within the self-heal window defined in docs/local-protocol.md. It MUST NOT write baselines for externally pinned entries. Entries without a recorded baseline outside the window keep the needs-re-confirmation state until the skill is reinstalled or its baseline is repaired externally.

#### Scenario: Fresh or degraded install establishes a baseline once

- **WHEN** a skill was installed through the app within the self-heal window and no baseline was ever recorded (for example the tree query failed at install time)
- **THEN** the next successful update check establishes the baseline once, and later checks compare without rewriting it

#### Scenario: Stale entry without a baseline is not silently rebased

- **WHEN** an entry has neither carrier field recorded and its install time predates the self-heal window, and the user checks updates
- **THEN** the check keeps the needs-re-confirmation state and writes no baseline, so any masked pending update stays visible for explicit repair

#### Scenario: Externally pinned entries never gain a baseline automatically

- **WHEN** an externally pinned entry has no recorded baseline and the user checks updates
- **THEN** the check skips it, reports the pinned state, and writes no baseline for it

### Requirement: Conflicting or incomplete provenance is surfaced

When an entry's baseline carriers disagree, or its source attribution is missing or unparseable, the app MUST present an explicit state requiring user decision. It MUST NOT silently pick one of the conflicting values, silently perform an update, or silently drop the skill from update status.

#### Scenario: Disagreeing baseline carriers

- **WHEN** an entry's carrier field and mirror field hold different tree SHAs, and the user checks updates
- **THEN** the skill is shown in an explicit conflict state and no update is fetched or performed for it

#### Scenario: Incomplete attribution stays visible

- **WHEN** an entry's source attribution is missing or cannot be parsed
- **THEN** the skill remains present in update status with an explicit state rather than disappearing from the results

### Requirement: External pin markers gate updates

Lock entries carrying an external pin marker (`pinnedRef`) MUST NOT be silently upgraded by desktop or CLI update flows. Until pin semantics are supported, such entries are skipped with an explicit status and their recorded fields are left unchanged by update operations. Pin installation UX is not part of this contract.

#### Scenario: Batch update skips externally pinned entries

- **WHEN** an update-all run encounters a managed entry carrying `pinnedRef`
- **THEN** the entry is skipped with an explicit status and its recorded content and provenance fields are unchanged

#### Scenario: Single-skill update refuses pinned entries

- **WHEN** an update targets a skill whose lock entry carries `pinnedRef`
- **THEN** the update is refused with an explicit reason and no skill files change
