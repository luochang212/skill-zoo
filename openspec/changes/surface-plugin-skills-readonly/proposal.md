# Proposal

## Why

Claude Code's plugin/marketplace system installs skills under `~/.claude/plugins/` (marketplace clones and per-plugin cache paths), which is outside every directory the app scans, so those skills are invisible in Skill Zoo — issue #8. Users hit this when looking up a skill's content that their agent clearly has. The workaround (manually importing the plugins folder) loses provenance and never refreshes.

## What Changes

- Discover skills that installed Claude Code plugins expose: `<installPath>/skills/<name>/SKILL.md` for every entry in `~/.claude/plugins/installed_plugins.json`, plus `~/.claude/plugins/marketplaces/<repo>/skills/<name>/SKILL.md` for cloned marketplace repositories. Discovery is manifest-driven for the cache — never a blind glob, because the cache keeps stale version directories alongside the installed one.
- Surface these skills on the Local page as read-only management objects with provenance (plugin and marketplace name): content viewable in the editor's read-only mode, but no editing, saving, linking, archiving, removal or update actions — the files belong to the plugin system, and the backend refuses mutations on those paths, not just the UI.
- Follow Claude Code's visibility setting: hiding the claude-code agent in Settings hides its plugin skills too.
- Keep plugin skills out of every same-name conflict, duplicate and install-preflight check: a name collision with a plugin skill never blocks an install, because the directories are disjoint and the agent resolves precedence itself.
- Scope is the Claude Code documented layout only; other tools' plugin systems, plugin enable/disable management, and deeper directory nesting stay out of scope.

## Capabilities

### New Capabilities

- `plugin-skill-visibility`: read-only discovery, provenance labeling and mutation refusal for skills exposed by installed Claude Code plugins.

### Modified Capabilities

- `local-skill-scope`: plugin skills join hidden-agent skills and external imports outside the same-name conflict, duplicate and install-candidate conflict scope.

## Impact

- `src-tauri/src/` — new plugin-source discovery feeding the existing scan/cache rebuild; a mutation guard for plugin-owned paths; EN/ZH provenance strings. No change to SSOT/agent-directory scanning or to the lock.
- `src/` — Local page read-only card state and editor read-only mode wiring for plugin skills.
- No protocol change: the lock, metadata and archive formats are untouched; plugin skills are derived from filesystem state exactly like the rest of the scan. No new dependencies; `installed_plugins.json` is plain JSON parsed with the existing JSON stack.
