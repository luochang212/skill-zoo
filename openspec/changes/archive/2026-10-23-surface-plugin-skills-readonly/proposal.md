# Proposal

## Why

Claude Code's plugin/marketplace system installs skills under `~/.claude/plugins/` (marketplace clones and per-plugin cache paths), which is outside every directory the app scans, so those skills are invisible in Skill Zoo — issue #8. Users hit this when looking up a skill's content that their agent clearly has. The workaround (manually importing the plugins folder) loses provenance and never refreshes.

## What Changes

- Discover plugin skills for every registered coding agent with one generic rule: walk the agent's home directory (everything except its flat skills directory, other agents' skills directories and the SSOT store), skipping junk directories, bounded in depth; any directory directly containing a `SKILL.md` is a plugin skill. No vendor layout knowledge; when a tree holds several copies of one skill name, the newest copy wins.
- Surface these skills on the Local page as read-only management objects with provenance (the source path they were discovered at): content viewable in the editor's read-only mode, but no editing, saving, linking, archiving, removal or update actions — the files belong to the plugin system, and the backend refuses mutations on those paths, not just the UI.
- Keep the Plugins category available whenever plugin skills are discovered, independent of coding-agent visibility: plugin skills are read-only inspections, not a managed surface of the agent.
- Keep plugin skills out of every same-name conflict, duplicate and install-preflight check: a name collision with a plugin skill never blocks an install, because the directories are disjoint and the agent resolves precedence itself.
- Scope is filesystem discovery only: no vendor layout is hard-coded, plugin install/enable/disable management stays with the owning tool, and directory nesting beyond the walk's depth cap is not followed.

## Capabilities

### New Capabilities

- `plugin-skill-visibility`: read-only discovery, provenance labeling and mutation refusal for skills exposed by installed Claude Code plugins.

### Modified Capabilities

- `local-skill-scope`: plugin skills join hidden-agent skills and external imports outside the same-name conflict, duplicate and install-candidate conflict scope.

## Impact

- `src-tauri/src/` — new plugin-source discovery feeding the existing scan/cache rebuild; a mutation guard for plugin-owned paths; EN/ZH provenance strings. No change to SSOT/agent-directory scanning or to the lock.
- `src/` — Local page read-only card state and editor read-only mode wiring for plugin skills.
- No protocol change: the lock, metadata and archive formats are untouched; plugin skills are derived from filesystem state exactly like the rest of the scan. No new dependencies; `installed_plugins.json` is plain JSON parsed with the existing JSON stack.
