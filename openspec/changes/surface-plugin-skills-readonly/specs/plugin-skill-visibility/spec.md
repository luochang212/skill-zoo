## ADDED Requirements

### Requirement: Plugin skills are discovered generically from every coding agent

The system SHALL apply one discovery rule uniformly to every registered coding agent, built-in or custom: walk the agent's home directory excluding its flat skills directory, other agents' skills directories and the SSOT store; skip the shared junk list, the app's own temp/backup directories, and symbolic links; bound the depth; and recognize every directory that directly contains a `SKILL.md` as a plugin skill. No vendor layout, manifest format or agent is special-cased.

#### Scenario: Marketplace clone is found

- **WHEN** an agent's home contains a cloned marketplace repository with `skills/<name>/SKILL.md`
- **THEN** those skills are discovered for that agent without any manifest

#### Scenario: Bundled and connector layouts are found

- **WHEN** an agent's home contains bundled skills or connector folders whose skill definition sits at any depth (for example `skills/SKILL.md` directly inside the folder)
- **THEN** each directory directly containing a `SKILL.md` is discovered as a plugin skill

#### Scenario: Covered surfaces and junk never surface

- **WHEN** the walk encounters the agent's flat skills directory, another agent's skills directory, the SSOT store, the shared junk list or app temp/backup directories
- **THEN** those subtrees are pruned and their skills are not double-reported

#### Scenario: Nested homes attribute ownership

- **WHEN** one agent's home is nested inside another agent's home and both walks can see the same skill
- **THEN** the skill is attributed to the agent with the deepest (nearest) home


### Requirement: Plugin discovery is user-controllable

Plugin skill discovery SHALL default to enabled and SHALL be switchable from Settings under Advanced features. When disabled, the system SHALL perform no plugin filesystem walk and SHALL remove previously discovered plugin skills from the Plugins category; enabling it again SHALL re-discover them on the next refresh.

#### Scenario: Disabled discovery has no runtime presence

- **WHEN** plugin discovery is switched off in Settings
- **THEN** refreshes perform no plugin walk, discovered plugin skills leave the Plugins category, and no plugin scan cost remains

#### Scenario: Re-enabling restores discovery

- **WHEN** the switch is turned back on
- **THEN** the next refresh re-discovers plugin skills and the category reappears
### Requirement: Duplicate names keep the newest copy

When one agent's tree holds several discovered copies of the same skill name — versioned caches do this — the system SHALL keep only the newest copy per agent and name. This heuristic is imperfect by design: it may keep a stale copy whose mtime is newer, and it may collapse distinct same-named skills.

#### Scenario: Versioned cache collapses

- **WHEN** an agent's plugin tree contains two copies of `alpha` and one copy of `beta`
- **THEN** exactly one `alpha` and one `beta` are listed, with `alpha` being the newest copy

### Requirement: Plugin skills are read-only management objects

Plugin skills SHALL appear on the Local page as viewable entries, but the system SHALL NOT modify them or the directories that contain them: no editing or saving, no linking to agents, no archiving, no removal and no update checks. The backend SHALL refuse write operations addressed at plugin-owned paths even if a client requests them, and the editor SHALL open these skills read-only.

#### Scenario: Content is viewable

- **WHEN** the user opens a plugin skill from the Local page
- **THEN** its SKILL.md and supporting files are displayed in read-only mode

#### Scenario: Mutations are refused

- **WHEN** any write operation (save, link, archive, remove, update) targets a plugin-owned skill path
- **THEN** the backend refuses the operation without modifying anything under the plugin tree

#### Scenario: No update state is offered

- **WHEN** the update manager enumerates skills
- **THEN** plugin skills are not included, since their lifecycle belongs to the plugin system

### Requirement: Plugin skills carry provenance and stay independently visible

Each plugin skill SHALL be labeled with its provenance — the owning plugin and, when known, the marketplace. The Plugins category SHALL be available whenever plugin skills are discovered, independent of coding-agent visibility: plugin skills are read-only inspections, so hiding the claude-code agent in Settings SHALL NOT hide them. Filesystem discovery SHALL NOT depend on that visibility.

#### Scenario: Provenance is shown

- **WHEN** a plugin skill is displayed in the Plugins category
- **THEN** its card identifies the owning plugin and marketplace alongside the skill metadata

#### Scenario: Hiding the agent keeps plugin skills inspectable

- **WHEN** the user hides the claude-code agent in Settings while its plugins expose skills
- **THEN** the Plugins category still lists those skills with full content view

### Requirement: Plugin skill name collisions stay independent

When a discovered plugin skill shares a name with an installed or imported skill, both SHALL remain separate entries distinguished by provenance. The system SHALL NOT merge, hide or overwrite either side, and SHALL NOT treat the collision as an error.

#### Scenario: Same name installed and in a plugin

- **WHEN** a plugin exposes a skill with the same name as an installed skill
- **THEN** both entries are shown with their own provenance and neither is modified
