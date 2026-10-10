# Skill Zoo Local Protocol

Skill Zoo desktop owns the local protocol. The CLI is an adjunct control surface: it may read and write desktop-owned local state, but it must follow the desktop app's protocol rather than define a separate one.

## Versioned Files

| File | Current Version | Role |
| --- | ---: | --- |
| `~/.agents/.skill-lock.json` | 3 | Desktop-owned install metadata for skills managed through Skill Zoo-compatible flows. |
| `~/.skill-zoo/archive/manifest.json` | 1 | Desktop-owned manifest for archived skills and restore metadata. |
| `~/.skill-zoo/imports.json` | 1 | Desktop-owned registry for skills imported from user-owned external folders. |
| `~/.skill-zoo/agents.json` | 1 | Desktop-owned custom coding-agent registrations. |
| `~/.skill-zoo/agent-lifecycle.json` | 1 | Recoverable multi-file registration lifecycle journal; transient. |

## Custom Agents

`agents.json` has a required `version: 1` and optional `agents` array (missing means empty). Each record has `id`, `label` and `skillsDir`. IDs are immutable `custom-<UUID>` values, never reused; labels are trimmed, 1–64 Unicode scalar values and case-insensitively unique among custom records (shipped labels do not affect registry validity). `skillsDir` is an absolute path to the folder containing skill folders. Readers tolerate extra optional fields. Missing files mean built-ins only; malformed files and unsupported versions are errors, never empty defaults, and must not be overwritten.

Built-in and custom labels may match when their directories are disjoint. Effective registry resolution gives existing custom roots priority: a built-in default with an equal, ancestor or descendant root is suppressed, including aliases and existing-ancestor comparisons when a leaf is missing. Desktop and CLI preserve UUIDs and registry bytes; they do not migrate references or infer usage capabilities from labels. Suppressed IDs are absent from operational enumeration and cannot be installation/link targets. Desktop `get_agent_paths` and CLI `paths` include informational records with optional `suppressedBy` (the conflicting custom ID); these are outside visibility/order/cap. CLI internal `getAllAgentPaths` excludes them unless informational reporting explicitly opts in. Suppression is derived per runtime snapshot, not persisted.

Removing or moving a custom root can make the built-in available again. Dormant built-in preferences remain stored, and reactivation respects the active visibility cap. Retained real skills and existing external imports keep external ownership and original IDs under the reactivated built-in root, including incremental refresh; new import authoring still rejects active agent/SSOT roots. Archives retain original destinations. No ID aliases or usage-adapter reassignment are made.


Built-ins are shipped defaults. Readers merge them with the custom registry once per operation. A custom registration does not provide a usage-log adapter; shared management is available, while tool-specific statistics require an implemented adapter. CLI consumers resolve the same IDs and directories; registration authoring belongs to desktop Settings.

Registration rejects equal, aliased and ancestor/descendant overlaps with other agent roots, SSOT and app state. Existing external imports retain external ownership if a custom agent encloses them. Changing a directory or unregistering preserves real files and other-agent links; retained real skills are recorded in `imports.json` with their previous skill IDs so metadata remains associated. Archive destinations retain their original paths. Removed-agent references are readable but do not redirect restores to a replacement agent.

### Lifecycle Coordination and Recovery

Lifecycle changes to `agents.json`, `imports.json`, `settings.json` and optionally `metadata.json` use a v1 `agent-lifecycle.json` journal. It contains `committed` (boolean), `before` and `after` objects mapping only those allowed filenames to their original/new UTF-8 contents, or `null` for absence. No arbitrary paths are accepted. A pending journal rolls back to `before`; a committed journal rolls forward to `after`. Recovery happens under the shared mutation lease before desktop startup or CLI mutations. Each file is replaced atomically; the journal is removed after recovery. Other state is not derived from the skill cache. Link cleanup follows durable commit and is best-effort, preserving real files and foreign links.

The cross-process lease reserves an IPv4 loopback TCP port for the app-config directory identity. On Unix use `unix:<device>:<inode>` from directory metadata, so case aliases and symlinks share a lease. On Windows use the canonical directory path, normalize separators to `/`, remove the `//?/` prefix and lowercase. Hash the resulting UTF-8 bytes with SHA-256, then use `10240 + (first two digest bytes as a big-endian u16 modulo 16384)`. The range stays below the usual automatic ephemeral-port range to avoid client-connection races after release. Both runtimes bind `127.0.0.1` exclusively for the operation. This is ownership only, not an HTTP/API service; it processes no commands. OS handle release also releases the lease after crashes, avoiding stale-PID reclamation races. A port collision or bind denial fails closed with an actionable busy/unavailable status. Existing operations touching agent targets cooperate with the lease. Network preparation may happen before acquisition only if paths are revalidated after acquisition.

Use matching desktop/CLI releases for custom agents: older releases ignore this registry and cannot promise custom-target parity. Downgrades preserve the registry and source files. Existing lock/archive/import schema versions remain unchanged.

`~/.skill-zoo/metadata.json` and `~/.skill-zoo/skills-cache.json` support desktop and CLI behavior, but they are not first-class versioned protocol files in this iteration. The cache is derived state and should not drive compatibility policy. `skills-cache.json` entries may include an optional `apps` map containing derived agent availability; readers must tolerate missing `apps` and writers should refresh it from filesystem state when rebuilding the cache.

## Agent Link Semantics

`directory` stores the skill's path relative to its owning skill root and may be nested, for example `.system/openai-docs`. Agent skill directories are flat compatibility surfaces: the link created under `~/<agent>/skills/` uses the final path segment of `directory`, for example `~/.opencode/skills/openai-docs`. Link creation must not overwrite an existing real directory or a symlink/junction that points to a different target. Link removal must only remove a symlink/junction that resolves to the skill's current `homePath`.

## GitHub Source Refs

For GitHub lock entries, `ref` stores an explicit branch only when the user or curated source selected one, for example a `/tree/<branch>` URL. Missing `ref` means the skill follows the repository's default branch. Readers must not treat a missing `ref` as `main`; writers must omit `ref` when the branch is unknown/default rather than guessing.

## External Imports

External imports are separately registered user-owned skill directories. New imports must originate outside Skill Zoo's SSOT and registered agent skill directories; existing external sources retain external ownership when a subsequently registered custom agent encloses them. The desktop app records these references in `~/.skill-zoo/imports.json`; the source directory remains the user's source of truth and must not be copied, moved, deleted, or archived by Skill Zoo-compatible tools.

An import entry's `sourcePath` points to the concrete skill root containing `SKILL.md`. `directory` stores the display/link identity used for agent symlink names. Readers should include valid external imports in installed-skill scans when `sourcePath/SKILL.md` exists. Missing or invalid external imports should remain in the imports registry for management and cleanup, but should not appear as installed skills.

Removing an external import means removing the registry entry and app-managed agent links that point to `sourcePath`; it must not remove files under `sourcePath`.

## Skill Scan Recognition

A directory is recognized as a skill when it contains a `SKILL.md`. Scans must skip directory names in the shared skip list (`node_modules`, `.git`, `dist`, `build`, `__pycache__`) and the desktop app's own temporary and backup directories, which follow the `.name.{install|update|backup}.` pattern (for example `.demo.install.456`, `.demo.backup.123.0`). Other dot-prefixed namespaces — such as `.system/openai-docs` — are real skill directories and must be scanned normally. Symlink/junction resolution for external imports happens before this directory-name filter, so external imports are unaffected.

## Compatibility Rules

- Desktop is the source of truth for local protocol shape and semantics.
- CLI changes must conform to the desktop-owned protocol and must not update fixtures to fit CLI implementation convenience.
- Readers should tolerate missing optional fields.
- Desktop and CLI writers must refuse versioned files with schema versions newer than they support.
- Adding optional fields usually does not require a schema version bump.
- Removing fields, renaming fields, changing required fields, or changing write/read semantics requires a schema version bump or an explicit migration plan.
- Do not rely on byte-for-byte JSON formatting. Compatibility is semantic.

## Fixture Maintenance

Fixtures live in `fixtures/local-protocol/` and represent the desktop app's current protocol.

Update fixtures only when the desktop-owned protocol intentionally changes or when a fixture is proven wrong. If a CLI test fails against these fixtures, fix the CLI first unless the desktop protocol itself changed.

For a new optional field, update the relevant `*-full.json` fixture. Keep `*-minimal.json` minimal unless the field is required. For an incompatible schema change, promote the current future-version fixture into the new current-version fixture and add the next future-version fixture.
