# Design

## Context

Claude Code owns `~/.claude/plugins/`: `installed_plugins.json` (version 2) maps `plugin@marketplace` to entries with an `installPath` under `cache/<marketplace>/<plugin>/<version>`; `marketplaces/<repo>/` holds cloned marketplace repositories, which may bundle `skills/` at the root. Verified on a live installation: the cache keeps retired version directories next to the installed one, and one installed plugin had no skills at all. The app's scanner today covers only the SSOT store and agent skills directories, so all of this is invisible. See proposal.md — Why and issue #8.

## Goals / Non-Goals

Goals:

- Read-only visibility of plugin-exposed skills with trustworthy provenance.
- Discovery that cannot surface stale cache content.
- One integration point: the existing scan/cache-rebuild pipeline, not a parallel store.

Non-Goals:

- No plugin management (install, update, enable, disable) — that stays Claude Code's job.
- No support for other tools' plugin layouts; claude-code only, extensible later via the same source model.
- No writes into the plugin tree, ever — including no symlinks from agent directories into it (a plugin update would move or delete the target and break the link silently).
- No nesting deeper than `<source>/skills/<name>/SKILL.md`; arbitrary tree-walking is out of scope.

## Decisions

**Manifest-driven cache discovery, glob-based marketplace discovery.** `installed_plugins.json` names the exact installed `installPath`, so only that path is read from `cache/` — the observed stale version directories (two version dirs for one plugin) would otherwise surface as phantom duplicates. Marketplace clones have no manifest of their own, but a clone's working tree is its content, so globbing `marketplaces/*/skills/` is safe. If the manifest is unreadable we degrade to marketplace-only rather than failing the scan. Alternative rejected: parsing `known_marketplaces.json` and plugin manifests (`.claude-plugin/plugin.json`) for richer metadata — not needed for visibility, and it couples us to more of a foreign schema than the capability requires (borrow capabilities, not compatibility).

**Plugin skills as a distinct object origin, not external imports.** They get their own origin kind in scan results so the UI and command layer can treat them uniformly: labeled, read-only, visibility-coupled to claude-code. Reusing `external` would drag in import-specific semantics (management actions, link repair) that must not apply here.

**Mutations refused in the backend, not just hidden in the UI.** Write commands (save, link, archive, remove, merge, update) check the target path against the discovered plugin roots and refuse with a clear error. The frontend hides the actions, but the guard is the boundary — same philosophy as the Tauri-only filesystem bridge.

**Freshness via the existing cache-rebuild cycle, not a dedicated watcher.** Plugin sources are scanned during every cache rebuild (startup and watched-root events), so plugin updates show up on the next rebuild or Local-page refresh, without adding watcher roots for a tree another tool owns. Accepted trade-off: a plugin update mid-session is not reflected until the next rebuild — acceptable for a read-only view, and it avoids racing Claude Code's own writes.

**Discovery results carry provenance, not the cache.** Plugin skills are re-derived from the manifest and filesystem on each rebuild like every other scan result. Nothing about them is persisted to the lock or metadata store, so uninstalling a plugin (or Claude Code itself) makes them disappear naturally — the filesystem stays the only source of truth.

## Risks / Trade-offs

- [Claude Code changes its plugin layout] → discovery is bounded to two documented source kinds and degrades to nothing visible if they move; no corruption is possible because we never write there. The capability is scoped so extending to a new layout is additive.
- [Marketplace clones bundle non-skill content] → only `skills/<name>/SKILL.md` one level below the clone root is recognized; large clones cost one directory listing each.
- [Users expect to "manage" plugin skills they can see] → provenance labels and read-only affordances must make ownership obvious; the refusal error names the owning plugin so confusion is answered at the moment it happens.

## Migration Plan

Purely additive view over existing filesystem state; no schema, lock or fixture changes. Rollback is a plain revert.

## Open Questions

None.
