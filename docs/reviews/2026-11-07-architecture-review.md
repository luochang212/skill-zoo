# 2026-11-07 Architecture Review

A three-track static review (Rust backend layering, frontend architecture, CLI/desktop protocol relationship), driven by the question: is this codebase layered like a mille-feuille (layers stacked past their purpose), a stack of unmerged patches, or lacking a clean architecture?

**Verification boundary:** all findings below are from source reading with `file:line` evidence, not executed tests. The semantic-drift findings (F1/F2) are structural conclusions, not reproduced failures. Where a prior review (`2026-10-24-code-review-triage.md`) already touched a topic, that review remains authoritative for its verdicts.

## Verdict

**The skeleton is real and above-average for a project of this size; the diseases are fatness and shadow implementations, not patchwork.** Three specific answers:

- **Not "no architecture."** The `commands → services → persistence` direction exists and is mostly respected; `error.rs` is carefully designed (`CommandError` with machine-readable codes, download-error classification with tests); `persistence/` has atomic writes and a transaction log; the frontend has a disciplined hooks layer and a central invalidation map.
- **Not "a pile of patches."** Zero TODO/FIXME/HACK, zero commented-out code across `src/`; only 2 of 40+ Tauri commands are invoked outside `lib/api`; production `unwrap`/`expect` counts are negligible; the few workarounds that exist are documented platform-quirk bridges (WKWebView IME guard, Radix dialog pointer-events shim).
- **Yes to two of the three, in bounded form:** the commands layer has grown a second service tier inside it (fatness), and the CLI/protocol area is a governed dual implementation where duplication has already produced observable semantic drift (patches not yet merged into the trunk).

## Strengths worth preserving

1. **Central invalidation map.** `src/hooks/queryInvalidation.ts:21-86` declares every mutation's dependent query keys in one map; all ~40 thin hooks in `useSkills.ts` go through `invalidateFor(qc, "…")`. Adding a dependent query touches one file.
2. **Shared protocol fixtures with two-sided tests.** `fixtures/local-protocol/` is consumed by both runtimes (`src-tauri/tests/protocol_fixtures_test.rs:8-10`; `packages/cli/tests/protocol-fixtures.test.ts`), including future-version rejection and the cross-runtime content-hash vector. Drift in versioned semantics is caught by CI.
3. **Error design at the core.** `src-tauri/src/error.rs:4-115` (fine-grained `AppError`, coded `CommandError`) and disciplined state (`store.rs` `acquire_local_lease` reloads metadata before locking to coexist with CLI writers, `store.rs:17-29`).
4. **Low patch-smell frontend.** Every workaround has a written rationale; the IPC boundary is a thin declarative wrapper (`src/lib/api/skills.ts:23-155`).

## Findings

### A. The commands layer is a second service tier (backend fatness)

`src-tauri/src/commands/skill.rs` is 4,114 lines / 42 commands, and it hosts real business orchestration:

- **A1** `archive_skill_inner` (`commands/skill.rs:1624`, ~194 lines) and `restore_archived_skill_inner` (`:1883`, ~272 lines) do manifest I/O, direct `std::fs` operations, handwritten rollback closures, and per-agent relinking — inside the IPC layer. `commands/agents.rs:813/830` calls them across modules, proving they are services in exile.
- **A2** The commands layer implements its own GitHub fetching and two disk JSON caches — `load_repo_metadata_cache`/`save_repo_metadata_cache` (`commands/skill.rs:2710/2726`) and readme cache (`:2799-2834`) — bypassing both `services/github.rs` and `persistence/`, creating a second cache-writing idiom alongside `SkillCache::save`.
- **A3** `commands/settings.rs:75-102` decodes a PNG data URL and `std::fs::write`s it at the command layer; `commands/translation.rs:35-43` defines persistence paths and does direct file I/O at the command layer.
- **A4** Scan/copy helpers (`scan_cached_skill_home` `:1404`, `remove_cached_skill_from_disk` `:1380`) live in commands; `update_skill` (`:944`) and `update_all_skills` (`:1084`) each maintain a near-duplicate helper cluster (`:1215-1357`).
- **A5** Five `*_for_test` production duplicates in `services/skill.rs` (:527, :1987, :2177, :2388, :2722) — twin entry points for the same logic.

### B. Mutable state has four homes

1. `AppState` (`store.rs:4-12`) — the intended one.
2. `TranslationState` with its own `config_lock` + `runtime` Mutexes, **defined in the commands layer** (`commands/translation.rs:27-30`, managed at `lib.rs:39`).
3. Two global `RwLock`s in `config.rs` (`GITHUB_CREDENTIALS` :59, `AGENT_SNAPSHOT` :436).
4. `static LOCK_WRITE` in `services/lock.rs:15` — SkillLock, a core store, sits outside `persistence/` entirely.

Each is individually defensible; collectively they mean "where does X live" is not answerable by convention.

### C. Error unification is cosmetic

`error.rs` is good, but 36 of 42 commands in `skill.rs` return `Result<_, String>`, as do nearly all commands in `settings.rs` (20/21), `agents.rs` (5/5), `translation.rs` (14/14), `discovery.rs` (1/1). There are 84 `map_err(|e| e.to_string())` sites in `commands/skill.rs` flattening `AppError` into strings, and three coexisting error-helper styles (`:801-816`, `:933`, `:2329`).

### D. The CLI is a zero-code-sharing shadow implementation (patches not merged)

`packages/cli/src/protocol/` (~3,400 lines TS) reimplements, module for module, what Rust already implements: scan ↔ `services/skill.rs` scan path; store ↔ `persistence/metadata.rs` + `services/lock.rs`; imports ↔ `persistence/external_imports.rs` + `commands/skill.rs:516-743`; archive ↔ `persistence/archive.rs`; agent-transaction ↔ `persistence/agent_transaction.rs`; custom-agents ↔ `persistence/agents.rs`; paths ↔ `config.rs`. All hash algorithms, ID formats, version caps, and migration rules are hand-mirrored, with the sync mechanism literally being comments: "Match the desktop" (`scan.ts:287,322,380,488`), "match it" for the 16-char archive-ID algorithm (`archive.ts:136-137`), "mirrors the desktop's MetadataStore migration" (`store.ts:93-119` ↔ `persistence/metadata.rs:25-87`).

This is a **governed dual implementation, not an SSOT**: the fixtures are shared, the ownership rule is written down (AGENTS.md, `docs/local-protocol.md`), and CI pins the versioned semantics — but every protocol change pays a two-runtime tax by design (AGENTS.md itself requires "fixtures + both sides' tests in the same change"). No schema package, no codegen, no shared kernel exists.

### E. `CliService` is a misnomer for third bloodline

`src-tauri/src/services/cli.rs` (2,526 lines) has nothing to do with `packages/cli`: its header (`cli.rs:1-3`) says it is a native Rust reimplementation of the vercel-labs `skills` CLI v1.5.3 that the desktop previously shelled out to. So the repo contains **three** "skills CLI" lineages: the vercel-labs original (now Rust-internalized under a misleading name), the self-authored TS CLI, and the desktop's own `SkillService`. Any discussion of "the CLI" must first disambiguate which one — the name costs everyone who touches it.

### F. Duplication has already drifted (the concrete cost of D/E)

- **F1 (copy)**: `CliService::copy_dir_contents_at_depth` (`cli.rs:998`, depth cap 20; dir symlinks skipped, file symlinks dereferenced) vs `SkillService::copy_dir_recursive` (`services/skill.rs:2610`, **no depth cap**; symlinks abort with rollback). Same operation, two different safety guarantees.
- **F2 (scan)**: `CliService::scan_dir` (`cli.rs:941`) vs `SkillService::scan_dir_recursive_into` (`services/skill.rs:1142`) — two near-isomorphic recursions with the same depth cap and skip rules, maintained separately.
- **F3 (single-side protocol)**: `packages/cli`'s `consistency.ts` / `diagnostics.ts` (doctor) have no desktop counterpart — protocol semantics implemented, tested, and owned by one runtime only.

### G. Frontend: disciplined layers, oversized main views

- **G1** `InstalledSkills.tsx:405-1233` is a single ~828-line function component: 10 `useState`, 5 `useEffect`, **20 `useMemo`**, 8 mutations, the whole filter→classify→sort→multiselect→batch pipeline (~15 chained memos, :487-663) and ~360 lines of JSX including four `BatchConfirmDialog`s. The file also inlines 5 skeleton components (:212-404) and two near-duplicate error JSX blocks (:677-689 vs :691-719).
- **G2** `SkillCompanionSettings.tsx` is the opposite shape — main component is only ~73 lines (:1047-1120), but 12 top-level definitions incl. two ~250-300-line dialogs share one 1,120-line file. `SkillContentPane.tsx` is a ~755-line single component (12 useState, 9 useEffect).
- **G3** Server-state discipline: one substantive violation — `SkillContentPane.tsx:213` mirrors a `queryClient.fetchQuery` result (:382-388) into local `nodes` state, creating two sources of truth for the file tree (mitigated by a session guard, but still a copy). `BrowseSkills.tsx:223,236` and `SkillMaintenanceSettings.tsx:66,289,335` fire `skillsApi` calls in event handlers without React Query.
- **G4** Two commands bypass `lib/api`: `useTheme.ts:29` (`set_window_theme`), `useAppUpdater.tsx:104` (`is_portable_build`). Single/batch mutation pairs (`useSkills.ts:196/207, 215/226, 234/256`) duplicate invalidation logic outside the central map.

## Priorities

1. **Unify scan/copy into one implementation** (F1/F2) — the only duplication that has produced divergent facts. One depth-capped, symlink-explicit copy primitive; one scan. Delete the twin. Small blast radius, removes real risk.
2. **Sink the service-tier code out of commands** (A1-A4) — `archive/restore`, repo-metadata/readme caches → `services/` + `persistence/`; commands become thin IPC wrappers. Do it incrementally, file by file.
3. **Rename `CliService`** (E) — e.g. `InstallService`/`NativeInstallService` — and fold its scan/copy into `SkillService` per priority 1. Pure rename + move; high clarity-per-line.
4. **Migrate commands to `CommandError`** (C) — mechanical, can ride along with priority 2.
5. **Consolidate the four state homes** (B) — at minimum move `TranslationState` out of the commands layer and document the four homes in one place.
6. **Split `InstalledSkills.tsx`** (G1) — extract the filter/selection pipeline into a hook and the batch dialogs into components. Cosmetic-ish but the highest-churn file in the app.
7. **Write down that `packages/cli` is a hand-mirrored dual implementation** (D) — one paragraph in `docs/local-protocol.md` stating that sync is manual + fixture-tested, so future contributors stop expecting a shared kernel. Long-term options (shared schema package, codegen, or CLI-through-IPC) deserve their own OpenSpec change, not a drive-by.

Items 1-3 address every place where duplication currently costs correctness; 4-6 are hygiene that keeps the cost from growing; 7 is a documentation truth-telling step.

## Appendix: metrics snapshot

| Metric | Value |
| --- | --- |
| Largest backend file | `commands/skill.rs` 4,114 lines (42 commands, ~677 test lines) |
| Largest service | `services/skill.rs` 4,032 lines; `services/cli.rs` 2,526 lines (~half tests) |
| Longest command-layer function | `restore_archived_skill_inner` ~272 lines |
| `Result<_, String>` commands | 36/42 in `skill.rs`; near-100% in settings/agents/translation/discovery |
| `map_err(\|e\| e.to_string())` in `commands/skill.rs` | 84 |
| Largest frontend component | `InstalledSkills` ~828 lines, 20 `useMemo` |
| TODO/FIXME/HACK in `src/` | 0 |
| Commands bypassing `lib/api` | 2 (`set_window_theme`, `is_portable_build`) |
| TS protocol parallel implementations | ~8-9 module pairs, 0 shared code |
| Protocol fixtures shared by both runtimes | Yes (`fixtures/local-protocol/`, incl. content-hash vector) |
