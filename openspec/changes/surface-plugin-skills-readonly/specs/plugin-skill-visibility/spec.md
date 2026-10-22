## ADDED Requirements

### Requirement: Plugin skills are discovered from two source kinds

The system SHALL discover skills exposed by installed Claude Code plugins from exactly two source kinds: the `installPath` of entries in `~/.claude/plugins/installed_plugins.json`, and cloned marketplace repositories under `~/.claude/plugins/marketplaces/`. Within each source, only `<source>/skills/<name>/` directories containing a `SKILL.md` are recognized.

#### Scenario: Installed plugin skill appears

- **WHEN** `installed_plugins.json` lists a plugin whose `installPath` contains `skills/<name>/SKILL.md`
- **THEN** that skill is discovered and appears on the Local page

#### Scenario: Marketplace-bundled skill appears

- **WHEN** a cloned marketplace repository contains `skills/<name>/SKILL.md`
- **THEN** that skill is discovered without any manifest entry

### Requirement: Cache discovery is manifest-driven

The system SHALL NOT discover skills under the plugin cache except through `installPath` values from the manifest, so stale version directories never surface. A missing or unreadable manifest SHALL skip only the manifest-derived sources and SHALL NOT surface an error on the Local page.

#### Scenario: Stale cache version is ignored

- **WHEN** the plugin cache contains a version directory that is not referenced by `installed_plugins.json`
- **THEN** skills under that directory are not discovered

#### Scenario: Unreadable manifest degrades gracefully

- **WHEN** `installed_plugins.json` is missing or unreadable
- **THEN** manifest-derived skills are skipped, marketplace-cloned skills still appear, and no error is surfaced to the Local page

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

### Requirement: Plugin skills carry provenance and follow agent visibility

Each plugin skill SHALL be labeled with its provenance — the owning plugin and, when known, the marketplace. Plugin skills SHALL be visible only while the claude-code agent is visible in Settings; hiding that agent hides its plugin skills, and showing it again restores them. Filesystem discovery SHALL NOT depend on that visibility.

#### Scenario: Provenance is shown

- **WHEN** a plugin skill is displayed on the Local page
- **THEN** its card identifies the owning plugin and marketplace alongside the skill metadata

#### Scenario: Hiding the agent hides plugin skills

- **WHEN** the user hides the claude-code agent in Settings
- **THEN** plugin skills leave the local view and reappear when the agent is shown again

### Requirement: Plugin skill name collisions stay independent

When a discovered plugin skill shares a name with an installed or imported skill, both SHALL remain separate entries distinguished by provenance. The system SHALL NOT merge, hide or overwrite either side, and SHALL NOT treat the collision as an error.

#### Scenario: Same name installed and in a plugin

- **WHEN** a plugin exposes a skill with the same name as an installed skill
- **THEN** both entries are shown with their own provenance and neither is modified
