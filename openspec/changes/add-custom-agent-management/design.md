# Design

## Context

See proposal.md for motivation and evidence limits. Rust currently uses `config::AGENTS` and static-lifetime configuration; the CLI independently imports `protocol/agents.ts`. Frontend `useAgentConfigs` queries backend data with infinite stale time. AgentManagerDialog already owns search, visible/hidden groups and drag ordering. Watcher supports incremental skill refresh and external path watch/unwatch. Visibility persistence intentionally precedes best-effort owned-link cleanup; this contract must remain intact.

The old experiment rebuilt an owned list on single-agent path lookup and did not reconcile newly registered watcher roots. Reusing its CRUD patch wholesale would carry these weaknesses forward.

## Goals / Non-Goals

**Goals:** One consistent registration view per operation; complete shared management parity; a restrained interaction that fits existing Settings; no user-file movement during registration lifecycle; measurable performance and testable ownership boundaries.

**Non-Goals:** Arbitrary executable plugins or user-supplied log parsing; automatic detection of every new tool; modifying built-in registrations; CLI registration-authoring commands. Existing tool-specific usage adapters remain supported; custom tools without an adapter do not expose statistics controls. Global Common Commands works independently of agent registration.

## Decisions

### 1. Interaction stays inside the existing manager

Reuse current Dialog primitives, styling and 600px manager layout; switch its content between list, add/edit and removal review instead of stacking modal focus traps. List header contains a persistent “Add Custom Agent” action; custom rows expose an accessible edit action in visible, hidden and search results. A subtle “Custom” label distinguishes editable registrations; built-ins retain existing actions.

Add/edit layout:

```text
← Manage Agents               Add Custom Agent / Edit Agent

Name *                        [My coding tool             ]
Skills directory *            [/absolute/path/skills       ] [Choose…]
                              Select the directory containing skill folders.
[ ] Create this directory     (only when the path is missing)


                              [Cancel] [Add Agent / Save Changes]
```

- Name: trimmed, 1–64 Unicode scalar values; case-insensitive uniqueness among custom labels; built-in/custom label collisions are allowed when directories are disjoint. IDs are generated UUIDs prefixed `custom-`, immutable and never derived from names or reused.
- Path: accepts an absolute path or leading `~/`, with backend expansion; no environment-variable or shell expansion. File picker uses a typed Rust IPC command; all existence and identity checks happen in Rust. Display the normalized full destination before saving; long paths remain copyable and wrap in editor/details.
- Validate after blur or submit, clear stale errors on edits; do not flag untouched fields. Associate errors with controls, announce errors and focus the first invalid field. Submit remains actionable for validation, disabled only while a mutation is pending. IME candidate confirmation does not submit.
- Missing-directory checkbox explicitly authorizes creation. Validation and confirmation are repeated server-side at commit; selecting a folder alone never creates it. If later persistence fails, remove only empty directories created by this operation, never pre-existing directories.
- Busy submission serializes lifecycle mutations, keeps a visible progress state and blocks duplicate submit/back/close. Failure keeps the draft with a local error. Unsaved back/Escape/outside-close opens an inline discard/continue decision; picker cancellation changes nothing.
- Save returns to the manager, reveals and focuses the saved row (clear a search only if it would conceal that row), preserves group/order state, and emits one concise success status. At the cap the added row is hidden and the status explains how to make space.
- Edit keeps the ID, allows rename and path change. A changed path triggers a review showing old/new locations and that old real skills stay externally managed; it never offers a “move files” action.
- Removal review lists counts of real skills retained, owned links eligible for cleanup and archived references. Primary label is “Remove Agent”; text explains that skill files remain. Cancel returns to the same row. Removing the last visible agent is rejected with an action to return to visibility management.
- Use existing en/zh namespaces, shared accessible labels/focus language, reduced-motion behavior and Safari 16.4-compatible APIs. Do not depend on newer validation pseudo-classes; use explicit field state. Review at 800×600 and 1280×800, 200% text zoom, light/dark themes and long localized names.

Alternative: a second settings page or nested dialogs increases navigation/focus complexity without adding capability; rejected.

### 2. Desktop owns a separate versioned registry

Introduce `~/.skill-zoo/agents.json` v1 with a registry of `{id,label,skillsDir}` records; built-ins remain shipped defaults and custom records cannot shadow their IDs. Publish exact schema/read-write rules in `docs/local-protocol.md` and full/minimal/future/invalid fixtures. Registry absence means no customs; invalid or future versions remain untouched and surface an error rather than disappearing as an empty list.

Resolved runtime configuration uses owned IDs/labels and absolute paths, origin (`builtin`/`custom`) and derived capabilities. Replace static-only enumeration and single-ID lookups throughout Rust and CLI with a merged snapshot. Keep usage collectors separate: a registration is not evidence of a supported log format. CLI loads the registry once per command and recognizes custom IDs wherever agent arguments or all-target enumeration occur.

Alternative: put registry inside desktop settings and make CLI decode stringified values; rejected because it couples an independent shared contract to unversioned preferences. Avoid a parallel custom-only install path.

### 3. Directory identity and ownership are explicit

Canonicalize existing roots and resolve aliases before checking equal or ancestor/descendant relationships. For missing paths, resolve the deepest existing ancestor and normalize the remainder; validate again after consented creation. Platform path semantics must cover Windows case/junction behavior and macOS symlink aliases. Reject overlaps with agent roots, SSOT, archive and the application state directory, including broad paths that enclose them; validate readability/directory kind and mutation permission when writing is needed.

External imports retain precedence over new agent scanning: a source already registered external remains external and appears once. No implicit ownership conversion. Same-name visibility/preflight contracts remain unchanged.

On path change/removal, enumerate real skill roots through production scanning, not cache alone. Retain valid remaining roots as external imports with stable skill metadata identity; continue other-agent links. Clean only owned links in the departing agent root after commit; never delete real directories or foreign/ambiguous links. Scan preservation also covers hidden agents. Missing old directories have no files to retain but archived references stay readable.

Alternative: reject every import overlap limits legitimate use; silently convert imports exposes destructive actions and violates ownership; both rejected. Dropping real skills from management on removal is also rejected.

### 4. Lifecycle writes are recoverable and operations use consistent snapshots

Registry lifecycle coordinates registry, preferences and external references. Use a short, shared local mutation lease for lifecycle and operations that create/remove agent links, including CLI; never hold cache/settings state locks across disk I/O, async boundaries or recovery. Prepare validated snapshots and a versioned lifecycle journal containing before/after records, then atomically replace affected files. A commit marker selects roll-forward; an uncommitted journal selects rollback. Desktop startup and CLI mutation entry recover before reading a mutable committed registry. The lease is an exclusive IPv4 loopback port derived from the app-config directory identity (Unix device/inode, Windows normalized canonical path; SHA-256 mapped to 10240–26623); it has no command API and the OS releases it on crashes. Port collisions fail closed. This avoids stale-PID reclamation races across Rust and Node without native locking dependencies. Document lease identity and journal paths/semantics in the protocol and cover crash points in fixtures/tests. Preserve unrelated preference/metadata fields.

The current installer holds the lease across preparation and writes, preserving its target snapshot through network waits; target preflight still runs after download. This avoids splitting the existing installer into a second execution model, at the cost of temporarily rejecting other cooperating agent mutations while preparation is pending. Deletion/path edits cannot interleave with target writes. Link cleanup is post-commit best-effort hygiene and cannot roll back a successfully committed visibility/removal preference; report remaining links and log diagnostic details without automatic cleanup retries.

This coordination is justified by multi-file file-preserving removal and CLI coexistence. It is bounded to agent-related state transitions, not a general transaction framework.

### 5. Reconcile runtime roots and all query consumers

Publish the new immutable registry snapshot after durable commit; update watcher desired roots as a deduplicated union of SSOT, archive, registered agents and external sources. Root removal must not unwatch a directory still needed by an external import. Register existing new roots immediately; explicitly retry a failed watch through user refresh, showing a degraded status while scans remain usable. Creating a previously missing registered root during install must also attach monitoring.

Perform a cache reconciliation scan for lifecycle changes, preserve stars/my-skills and refresh `apps`, origin/homeAgent and link-derived state. Rename updates labels without a needless skill scan. Emit one typed registry change and invalidate configs (despite infinite stale time), paths, preferences/order, installed skills, symlinks, conflicts/consistency, archive and relevant usage queries. Refresh open install/configure dialogs; stale selections cannot target an absent agent.

### 6. Parity matrix is a release gate

| Surface | Custom-agent expected behavior | Verification |
| --- | --- | --- |
| Settings | Search, paths/open, visibility/cap, order, add/edit/remove | Component interaction tests + keyboard review |
| Local/detail | Discovery, file read/edit, star/my-skills, source ownership | Shared built-in/custom production-path cases |
| Install/update | SSOT copy, selected preflight, per-target links, source-based update eligibility | Rust + CLI filesystem fixtures |
| Configure/drag/batch | Toggle, multi-target link/unlink, conflict protection | Real link tests + frontend target selection |
| Scope/consistency | Hidden roots scanned; visible roots affect conflicts; external excluded | Shared scope cases |
| Archive/restore | Origin eligibility, rollback, recorded destinations, absent agent handling | Rust + CLI archive cases |
| Watch/cache | No restart, create/delete/edit, retained external watch coverage | Event/registry reconciliation cases |
| CLI/diagnostics | Same IDs/paths, custom arguments, all-target handling | Shared protocol + integration cases |
| Statistics/Common Commands | Existing collectors unchanged; unsupported status honest; commands global | Capability/query tests + UI review |

Audit all static enumerations and agent-ID special cases, including update, import, diagnostics and recovery. Only real tool-specific collectors may retain ID-specific dispatch. No checklist item can be dropped merely because the custom row appears in Settings.

### 7. Measure performance using production operations

Take baseline on the pre-implementation main commit and record hardware/build/profile. Compare 0, 5 and 20 custom roots, empty and populated, with 100 and 1,000 skills; use repeated warm runs (median and p95), consistent fixtures and no user directories. Measure registry loads/list allocations, scan/rebuild, per-skill agent detection, incremental refresh and lifecycle reconciliation. Runtime must not reread/reparse the registry or rebuild its entire list per skill/path lookup. Zero-custom warm median should remain within 10% or 5ms, whichever is larger; investigate regressions instead of hiding them in noise. Additional populated-root cost is reported separately from registry overhead. Performance evidence is recorded at implementation, not claimed from this design.

## Risks / Trade-offs

- [Wrong file ownership] → External precedence, preserved references, byte/file inventory checks and fail-before-write overlap validation.
- [Partial lifecycle commit] → Durable before/after journal, shared mutation lease and injected failure/crash recovery tests on both surfaces.
- [Growing scan cost] → Reuse snapshots and incremental watcher; measure extra roots rather than treating the visibility cap as a scan cap.
- [Removal leaves owned links] → Concise post-commit status; preserved original files and foreign links; no automatic destructive retry.
- [Unsupported arbitrary logs] → Explicit capability status; all shared management retained. No pretend parser compatibility.
- [Registry expansion touches many consumers] → Parity matrix and static-enumeration audit; limit refactoring to agent assumptions.

## Migration Plan

Absent new files preserves current behavior. Introduce v1 protocol and readers on both surfaces in the same implementation; do not migrate old experimental settings automatically without a documented supported source format. Existing built-in IDs/preferences and archive destinations remain unchanged. Normalize new IDs into ordering when reading, so stale preference entries do not suppress registration.

Older app/CLI releases do not recognize custom roots. Document this limitation: use matching releases for custom-agent management; downgrades leave `agents.json` and user files intact and must not be advertised as fully custom-aware. Registry version guards protect future readers; existing lock/archive versions remain unchanged unless verification proves a required protocol change, which must update docs/fixtures/tests together.

### 8. Official support does not migrate existing custom identity

Custom registrations are user choices; shipped entries are defaults. The effective snapshot suppresses only built-in roots overlapping customs (equal, ancestor or descendant, including aliases and existing-ancestor resolution for missing leaves). It preserves the custom UUID, directory and capabilities; equal labels alone do not suppress defaults. Registry validation enforces custom/custom label uniqueness independently of the installed shipped catalog, so adding a built-in cannot invalidate previously valid bytes. Authoring keeps directory overlap checks; custom/built-in labels can coexist and manager rows distinguish origin and path.

Suppressed defaults have read-only “Not enabled” management entries explaining the overlapping custom registration, outside visibility/order/cap and all operational target enumeration. Desktop path reporting and CLI `paths` expose `suppressedBy` consistently; operational path enumeration remains active-only. No built-in ID aliases, automatic migration, inferred usage adapter or persisted suppression table is introduced. A runtime snapshot performs reconciliation once, never per-skill registry loading.

When removal/path editing ends overlap, the built-in returns. Dormant built-in visibility preferences remain stored, but reactivation cannot grow the active visible set above seven. Existing external imports (including retained custom native IDs) continue to override native scanning under the reactivated root, in full and incremental scans; new import authoring still rejects currently registered roots. Archives retain recorded destinations and absent custom links are skipped normally.

Rejected: fail startup (breaks upgrades); coexist at the same physical root (duplicate targets/ownership); automatic custom-to-built-in migration or ID aliases (rewrites historical references and confuses identity with tool capabilities); suppression on label alone (hides unrelated directories). Trade-off: a suppressed built-in's specialized statistics are unavailable until overlap is removed; labels cannot establish log compatibility.

The user requested removal of the generic management/Common Commands/unsupported-statistics paragraph from the editor. Capability data and supported-only statistics selection remain intact; the editor has no redundant capability paragraph.
