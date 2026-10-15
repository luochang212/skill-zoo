# Skill Zoo Local Protocol

Skill Zoo desktop owns the local protocol. The CLI is an adjunct control surface: it may read and write desktop-owned local state, but it must follow the desktop app's protocol rather than define a separate one.

## Versioned Files

| File | Current Version | Role |
| --- | ---: | --- |
| `~/.skill-zoo/metadata.json` | 1 | Desktop-owned user flags with conservative legacy v0 migration. |
| `~/.agents/.skill-lock.json` | 3 | Desktop-owned install metadata for skills managed through Skill Zoo-compatible flows. |
| `~/.skill-zoo/archive/manifest.json` | 1 | Desktop-owned manifest for archived skills and restore metadata. |
| `~/.skill-zoo/imports.json` | 1 | Desktop-owned registry for skills imported from user-owned external folders. |
| `~/.skill-zoo/agents.json` | 1 | Desktop-owned custom coding-agent registrations. |
| `~/.skill-zoo/agent-lifecycle.json` | 1 | Recoverable multi-file registration lifecycle journal; transient. |

## Custom Agents

`agents.json` has a required `version: 1` and optional `agents` array (missing means empty). Each record has `id`, `label` and `skillsDir`. IDs are immutable `custom-<UUID>` values, never reused; labels are trimmed, 1–64 Unicode scalar values and case-insensitively unique among custom records (shipped labels do not affect registry validity). `skillsDir` is an absolute path to the folder containing skill folders. Readers tolerate extra optional fields. Missing files mean built-ins only; malformed files and unsupported versions are reported, never silently treated as empty, and must not be overwritten: desktop startup degrades to built-in agents while logging the parse failure, later registry mutations surface the parse error, and writers preserve the original bytes.

Built-in and custom labels may match when their directories are disjoint. Effective registry resolution gives existing custom roots priority: a built-in default with an equal, ancestor or descendant root is suppressed, including aliases and existing-ancestor comparisons when a leaf is missing. Desktop and CLI preserve UUIDs and registry bytes; they do not migrate references or infer usage capabilities from labels. Suppressed IDs are absent from operational enumeration and cannot be installation/link targets. Desktop `get_agent_paths` and CLI `paths` include informational records with optional `suppressedBy` (the conflicting custom ID); these are outside visibility/order/cap. CLI internal `getAllAgentPaths` excludes them unless informational reporting explicitly opts in. Suppression is derived per runtime snapshot, not persisted.

Removing or moving a custom root can make the built-in available again. Dormant built-in preferences remain stored, and reactivation respects the active visibility cap. Retained real skills and existing external imports keep external ownership and original IDs under the reactivated built-in root, including incremental refresh; new import authoring still rejects active agent/SSOT roots. Archives retain original destinations. No ID aliases or usage-adapter reassignment are made.


Built-ins are shipped defaults. Readers merge them with the custom registry once per operation. A custom registration does not provide a usage-log adapter; shared management is available, while tool-specific statistics require an implemented adapter. CLI consumers resolve the same IDs and directories; registration authoring belongs to desktop Settings.

Registration rejects equal, aliased and ancestor/descendant overlaps with other agent roots, SSOT and app state. Existing external imports retain external ownership if a custom agent encloses them. Changing a directory or unregistering preserves real files and other-agent links; retained real skills are recorded in `imports.json` with their previous skill IDs so metadata remains associated. Archive destinations retain their original paths. Removed-agent references are readable but do not redirect restores to a replacement agent.

### Lifecycle Coordination and Recovery

Lifecycle changes to `agents.json`, `imports.json`, `settings.json` and optionally `metadata.json` use a v1 `agent-lifecycle.json` journal. It contains `committed` (boolean), `before` and `after` objects mapping only those allowed filenames to their original/new UTF-8 contents, or `null` for absence. No arbitrary paths are accepted. A pending journal rolls back to `before`; a committed journal rolls forward to `after`. Recovery happens under the shared mutation lease before desktop startup or CLI mutations. Each file is replaced atomically; the journal is removed after recovery. Other state is not derived from the skill cache. Link cleanup follows durable commit and is best-effort, preserving real files and foreign links.

The cross-process lease reserves an IPv4 loopback TCP port for the app-config directory identity. On Unix use `unix:<device>:<inode>` from directory metadata, so case aliases and symlinks share a lease. On Windows use the canonical directory path, normalize separators to `/`, remove the `//?/` prefix and lowercase. Hash the resulting UTF-8 bytes with SHA-256, then use `10240 + (first two digest bytes as a big-endian u16 modulo 16384)`. The range stays below the usual automatic ephemeral-port range to avoid client-connection races after release. Both runtimes bind `127.0.0.1` exclusively for the operation. This is ownership only, not an HTTP/API service; it processes no commands. OS handle release also releases the lease after crashes, avoiding stale-PID reclamation races. A port collision or bind denial fails closed with an actionable busy/unavailable status. Existing operations touching agent targets cooperate with the lease. Network preparation may happen before acquisition only if paths are revalidated after acquisition.

Use matching desktop/CLI releases for custom agents: older releases ignore this registry and cannot promise custom-target parity. Downgrades preserve the registry and source files. Existing lock/archive/import schema versions remain unchanged.

`~/.skill-zoo/metadata.json` is a first-class v1 protocol file (see User metadata v1 below). `~/.skill-zoo/skills-cache.json` supports desktop and CLI behavior as unversioned derived state. The cache is derived state and should not drive compatibility policy. `skills-cache.json` entries may include an optional `apps` map containing derived agent availability; readers must tolerate missing `apps` and writers should refresh it from filesystem state when rebuilding the cache.

## Agent Link Semantics

`directory` stores the skill's path relative to its owning skill root and may be nested, for example `.system/openai-docs`. Agent skill directories are flat compatibility surfaces: the link created under `~/<agent>/skills/` uses the final path segment of `directory`, for example `~/.opencode/skills/openai-docs`. Link creation must not overwrite an existing real directory or a symlink/junction that points to a different target. Link removal must only remove a symlink/junction that resolves to the skill's current `homePath`.

## GitHub Source Refs

For GitHub lock entries, `ref` stores an explicit branch only when the user or curated source selected one, for example a `/tree/<branch>` URL. Missing `ref` means the skill follows the repository's default branch. Readers must not treat a missing `ref` as `main`; writers must omit `ref` when the branch is unknown/default rather than guessing.

## Shared Lock Baselines and External Writers

`~/.agents/.skill-lock.json` is a shared interop surface: `npx skill` and `gh skill` also read and rewrite it. Their rewrites are lossy for fields their own schemas do not declare, and a same-name install from an external tool rebuilds the whole entry. The lock therefore carries the update baseline (the skill folder's git tree SHA) in two fields:

- `skillFolderHash` is the authoritative baseline carrier. `gh skill` preserves it across rewrites of unrelated entries and `npx skill`'s update path consumes it as a git tree hash.
- `commitSha` is the legacy mirror. Its historical name is misleading: the value has always been the skill subtree's git tree SHA, not a commit SHA. It is kept in sync for older readers and as a downgrade path.

Read order for update checks: use `skillFolderHash` when it holds a value; otherwise fall back to `commitSha`; if both hold different values, that is an explicit conflict state requiring user decision, never silently reconciled; if neither holds a value, the entry has no recorded baseline and is shown as needing re-confirmation rather than reported up to date. Missing, `null`, and empty-string baseline values all count as unrecorded — older writers left empty-string placeholders, and JSON rewrites may omit fields entirely.

Baseline write rules: install and update flows write both fields with the same value, derived from the content they actually installed or updated. Update checks never write a baseline: a network-time snapshot cannot prove the installed content still matches the remote tip, and writing it during a check would silently rebase an entry another writer changed in the meantime. An entry with no recorded baseline keeps its needs-re-confirmation state until the skill is reinstalled or its baseline is repaired externally (see "External baseline repair" below). A missing `ref` keeps the default-branch semantics above and must not be guessed during recovery.

### External baseline repair

An entry with no recorded baseline can be repaired without reinstalling by reconstructing the baseline from the skill's repository history. This procedure is protocol-legitimate for any tool, including the user's AI assistant:

1. Read the entry's `source` (`owner/name`), `skillPath`, and `installedAt` from the lock.
2. Resolve the last commit that touched `skillPath` at or before `installedAt`: `GET /repos/{owner}/{repo}/commits?path={skillPath}&until={installedAt}` and take the first result.
3. Fetch that commit's repository tree (`GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1`) and locate the blob SHA of the `skillPath` directory.
4. Write that tree SHA into **both** `skillFolderHash` and `commitSha` of the entry (the two fields carry the same value by protocol).

If any step fails, or the entry has no parseable `installedAt`, reinstalling the skill is the fallback repair. Repair must never invent values: an unverifiable baseline is worse than none.

Writers preserve lock fields they do not declare — entry-level and top-level, including `pinnedRef` — across every read-modify-write. Entries carrying a non-empty `pinnedRef` are externally pinned: update flows skip them with an explicit status until pin semantics are supported, and single-skill updates refuse them. Missing, `null`, and empty `pinnedRef` values do not pin. No pin installation UX is defined by this protocol.

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

## User metadata v1

`~/.skill-zoo/metadata.json` is desktop-owned versioned state: `{ "version": 1, "entries": { "<key>": { "starred": true, "isMine": false } } }`.
SSOT keys are `ssot:<normalized root-relative directory>`, including full nested paths such as `ssot:.system/demo`. Components must be nonempty and cannot be `.` or `..`; absolute paths, backslashes and colons are rejected. Other origins retain their existing IDs, including historical IDs retained by imports. Cache row IDs still derive from current provenance. Both runtimes accept exactly two nonempty source segments for repo identity; malformed sources have no repo identity.

Flags describe an installation slot: changing source or deleting a lock retains flags; an unrelated skill replacing the same slot also inherits them. Offline directory moves do not carry flags automatically.

Missing version is legacy v0. Under the shared mutation lease, re-read disk and migrate once, atomically saving only metadata as v1. Historical `repo:owner/repo:<directory>` records can move to the stable key only for an existing root-contained SSOT directory with SKILL.md, excluding IDs retained by imports. A unique candidate or candidates with identical booleans can move, consuming old keys. A differing existing target or contradictory candidates prevents the whole group from moving. Missing skills, unsafe paths and unparseable records remain untouched. Never OR flags, overwrite conflicting targets or infer ownership from cache. Once v1, migration is not retried. Unbound records never act as lookup aliases.

Unknown top-level fields are preserved; unknown entry fields and malformed boolean/version values are rejected without replacing the file. Both writers refuse metadata versions above v1 before filesystem mutations. Archive v1 keeps its historical originalSkillId; restores apply its flag snapshot through the destination origin/directory key. Explicit user-requested duplicate merge retains its existing OR semantics.

Migration reports unbound records to stderr. Inspect them with `skill-zoo metadata list`. Explicitly assign exact flags (including replacing destination flags) with `skill-zoo metadata resolve '<legacy-id>' --to 'ssot:demo' --yes`, or discard one with `skill-zoo metadata resolve '<legacy-id>' --discard --yes`. Assignment requires an existing SSOT destination; retained imports cannot be consumed by this interface. These commands operate under the shared lease. Preserve an offline backup before manual resolution if the desired attribution is uncertain.

Upgrade desktop and CLI together. Old binaries do not understand metadata version guards; downgrade is not safe without restoring an offline pre-upgrade backup. Backups are never runtime read sources. See `metadata-v0-legacy`, `metadata-v1-minimal`, `metadata-v1-full`, `metadata-v1-migration-conflicts` (legacy input exercising the v1 migration), and `metadata-v2-future` shared fixtures.

## Reserved gh Provenance and Remote Update Authorization (C2)

This is an explicit read/refusal compatibility revision with **no storage migration**: lock v3, archive v1 and metadata v1 remain unchanged. Desktop updates inspect the actual SSOT installation's `SKILL.md` before tree requests or ZIP downloads, independently of its lock association. Single, all, checked and direct service updates use the same guard; a forged checked request cannot bypass it.

Only leading YAML frontmatter with complete standalone `---` delimiter lines is interpreted. BOM, CRLF and leading blank lines are supported. The existing YAML parser resolves aliases and merges. Any `metadata` map containing **any** of `github-repo`, `github-ref`, `github-tree-sha`, `github-path`, `github-pinned` (gh v2.102.0), or legacy `github-owner` / `github-sha`, is `Tracking`, even with missing companion fields, null, empty or non-string values. Root-level names, `github-stars`, descriptions and body examples do not count. Safely parsed ordinary metadata (including scalar/null/sequence metadata without map tracking semantics), or no frontmatter, is `Absent`. Duplicate keys, nonstandard tags, invalid YAML/merges, unclosed frontmatter, missing/unreadable files or invalid UTF-8 are `Unreadable`, never absence.

Check reports `ghProvenanceProtected` for Tracking and `skillProvenanceUnreadable` for unsafe reads, with `hasUpdate=false` and no latest SHA; issue-bearing items are excluded from frontend candidates. Physical/read issues precede tracking, which precedes pin/baseline/source issues. The original pin and baseline fields remain truthful. Users should use gh to update protected installations; changing management requires a separate explicit operation. Unreadable files require inspection and retry. Single updates return the existing CommandError code/message; batches use `directory: [code] message` and existing counts/history.

Allowed updates retain an operation-local snapshot of original SKILL.md bytes and physical directory identity before network work. Before staging and immediately before replacement, observed byte/identity changes cause `updateStateChanged`, asking users to check again. Changed files are never reparsed as fresh authorization, and temporary staging is discarded without rolling back over external edits. Only successfully replaced items advance their original lock entries' timestamps and dual baselines.

For a single refusal or wholly refused batch, all target file bytes, symlink destinations and **raw lock bytes** stay unchanged; the lock is not empty-written. Mixed batches can change the lock file for successful items, but each refused item's original key/entry semantics (including unknown fields, pin, dual baselines and timestamps) remain unchanged. Cache refresh and existing update history can still write app state.

Detection is conservative reserved-field protection, **not proof of installer history**: upstream-authored identical metadata is also protected, while previously stripped tracking cannot be recovered or recognized. No manager registry, automatic conversion, gh invocation or provenance reconstruction is introduced. Installation/lock association follows the B1 rules below; these never authorize overriding C2 protection. AgentLease coordinates participating desktop/CLI writers; a non-cooperating external writer can still act between final read and rename. This guard is not cross-tool CAS or a directory-plus-lock transaction.

`fixtures/local-protocol/gh-injected.md` preserves the audit's actual gh injection output; `gh-update-guard-cases.json` fixes the YAML detection contract. Rust tests exercise real update/refusal and filesystem preservation. CLI has no remote update API: its conformance boundary is real scan → archive → restore retaining SKILL.md bytes and lock fields, without an invented parity implementation.

## Installation / Lock Association (B1)

This is a no-storage-migration read/refusal compatibility revision. Lock v3, archive v1 and metadata v1 remain unchanged. Upgrade desktop and CLI together. No automatic rekey, directory move, archive rewrite or second ledger is introduced.

An operation first collects all real skill directories under SSOT and every agent root, independently of visibility. Skip symlinks/junctions, common excluded directories and app staging/backup names; retain .system. Canonical identities deduplicate aliases only within the operation. External import sources never own shared lock entries. Enumeration and lock I/O failures are errors, not missing associations.

Resolve candidates before selecting: SSOT exact relative keys, historical leaf keys and corroborated namespace/leaf keys. Namespace and agent associations require valid metadata.github-repo GitHub URL and metadata.github-path matching the strict lock owner/repo (case insensitive), optional sourceUrl host/repo, and skillPath directory (case sensitive). Ref, tree SHA, YAML name, suffix or repo alone never prove association. Only github.com HTTPS evidence is supported. An ordinary same-named agent directory does not inherit or compete for an SSOT entry; positive independent evidence can create a shared-entry conflict. Visibility does not change ownership.

Multiple original keys, one entry claimed by independent directories, or valid tracking evidence contradicting exact/leaf association are Ambiguous. No corroborated candidate is Missing. Missing/Ambiguous scans retain physical objects without fabricated repo provenance. Ambiguous mutations fail before side effects. Missing remote updates fail; Missing local archive/delete/edit operations do not guess or remove another record. Check is read-only, reports physical directory in skillName, emits lockMissing/lockAmbiguous issues, and excludes dangling locks as update targets.

skillPath is read through a safe directory view: support relative paths, backslash separators, empty/dot roots, and one complete final SKILL.md component. Reject absolute, parent and drive forms. Never rewrite the original field or normalize map keys. File replacement, results and refresh use install_directory; baseline/updatedAt writes and deletion use exact lock_key. Before replacement, re-read lock/inventory and require the original key and full entry snapshot, physical identity and SKILL.md bytes; compare entry again inside baseline commit. Refuse changes with updateStateChanged. Non-cooperating external writers remain outside an atomic directory-plus-lock transaction.

Archives preserve exact lockKey and complete entry fields. Before moving an archive back, require its original key to be empty or semantically identical, and reject competing candidate associations. Historical archives lacking lockKey use directory only as the legacy fallback. Do not normalize historical lockKey. An equal entry need not be rewritten; failure rollback restores before values only for keys changed by this operation, preserving preexisting equal entries.

Shared lock-resolution-layouts.json fixtures exercise actual filesystem collection and resolution on Rust and CLI.
