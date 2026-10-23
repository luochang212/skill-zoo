# AGENTS.md

## How We Work

**Weigh benefits against side effects.** When making a choice, consider whether the benefits outweigh the side effects.

**Aesthetics and elegance matter.** Beauty is a form of productivity.

**Reason from first principles.** Strip problems to verifiable facts, then reason upward. "That's how it's done" is not a fact.

**Think before you write.** State your assumptions. Surface tradeoffs. If there are multiple interpretations, lay them all out — don't silently pick one. If something is unclear, stop and ask. Before any change, ask: Will this introduce a bug? Is this more complex than it needs to be? Do the benefits outweigh the side effects?

**Solve with minimal code.** Don't add features no one asked for. Don't build abstractions for single-use paths. Don't write error handling for scenarios that can't happen. Don't add "configurability" no one requested. Every extra layer, dependency, or indirection must earn its keep — expressing more with less code is cool.

**Touch only what you must.** Don't refactor adjacent code. Don't fix formatting you didn't break. Match the existing style, even if you'd write it differently. Only remove imports that your changes made unused.

**Consistency is load-bearing.** Layers that assume different realities pass local checks but fail globally. A foundation that shifts before the structure above settles doesn't enable iteration — it guarantees rot. When a design decision changes, find every place that assumed the old one — stale code is a bug that hasn't manifested yet.

**Verify before claiming done.** Don't say you ran something if you didn't. If you can't verify, say so.

**Prefer the latest stable.** When choosing dependency versions, use the latest stable release.

**Recognize local optima.** When a series of incremental changes reveals that a broader refactor would yield a better outcome, stop and ask the user before proceeding.

## Branch Canonicality

`main` is the canonical development line; CI runs on every push and PR to it. `next/own-protocol` has been fast-forwarded back into `main`. `next/curated` is the 0.3.56 compatibility experiment (`v0.3.56-beta.4` local tag) and `next/verified-baselines` is the frozen 0.3.56 prerelease experiment; both are reference-only.

## What This Project Is

A desktop app for managing AI coding assistant Skills. Users browse, install, create, and manage Skill files across multiple agents (Claude Code, Codex, Gemini, Cursor, etc.).

Core insight: a Skill is a file. This app is essentially a file manager with a purpose-built UI.

## Project Layout

- **Desktop app** — `src-tauri/`
- **CLI** — `packages/cli/`
- **Project website** — `site/` (independent static Astro build; see `site/README.md`)

## Core Design Decisions

### The Filesystem Is the Source of Truth

Skills exist as ordinary files on disk. The cache is not the source of truth — the filesystem is. The cache is rebuilt from the filesystem state, and stale entries are cleaned up on rebuild. User metadata (stars, "my skills") is preserved across rebuilds.

This means: if a user drops a skill folder into the right directory, the app discovers it. If they `rm` one, the app notices. The app reflects reality, not the other way around.

### SSOT + Symlinks

`~/.agents/skills/` is the canonical store for installed and user-created skills. Agent directories contain only **symlinks** pointing to the real location.

There are two origins, and the symlink target depends on origin:

- **Remote install** (from GitHub): ZIP is downloaded → extracted to a temp dir → files are **copied** into `~/.agents/skills/<name>/` → agent dirs symlink to SSOT. Copying is necessary here because the temp dir is ephemeral; there is no stable source to link to.
- **User's local skill** (already in an agent dir like `~/.hermes/skills/`): The skill stays where it is. **Never copy or move it.** Other agent dirs symlink directly to the original location. The app discovers these skills by scanning all agent directories and using `detect_home_path` (which skips symlinks to find the real directory).

In both cases, agent directories only ever contain symlinks — never copies. The difference is where the symlink points: SSOT for remote installs, the user's original directory for local skills.

This design respects the user's files and avoids creating divergent copies. If a skill were copied instead of linked, the copy would silently drift from the original — the user edits one version while the other becomes stale. A single source of truth per skill, whether in SSOT or the user's own directory, prevents this.

### Local Visibility and Conflict Scope

The desktop app scans filesystem truth broadly, but user-facing local views and install conflict checks use a narrower **visible local scope**:

- Always include SSOT skills in `~/.agents/skills/`.
- Include real `origin=agent` skill directories only when their `homeAgent` is currently visible in Settings.
- Keep `origin=external` imports visible as management objects, even when not linked to any agent.
- Do not include hidden-agent skills or external imports in same-name conflict/duplicate consistency checks.
- Discover/repository install conflict checks must use the same scope: SSOT plus visible-agent real directories, excluding external imports.
- Install preflight must check SSOT plus the agent directories selected for that install operation, not every visible or known agent directory.

This prevents hidden agents or external import records from creating conflicts that users cannot find on the Local page, while preserving external imports as manageable entries.

### Local Protocol Guardrails

The desktop app owns Skill Zoo's local protocol. The CLI is an adjunct control surface that must conform to desktop-owned local state; it must not define an independent schema or change protocol fixtures for its own convenience.

Protocol-impacting work includes changes to desktop-owned local state shape, paths, schema versions, lock/archive write semantics, or user-visible compatibility and migration behavior. When such work is intentional, update the local protocol document, desktop protocol fixtures, and both CLI and Rust protocol tests in the same change.

The fixtures under `fixtures/local-protocol/` represent the desktop app's current protocol. If a CLI fixture test fails, fix the CLI to follow the desktop protocol unless the desktop protocol itself intentionally changed.

### Compatibility with external skill managers

`CliService` is our native implementation of the install/update behavior we need. We do not target protocol compatibility with `npx skill` or `gh skill`; their schemas and semantics are sources of ideas, not contracts. Borrow capabilities when they improve our product; do not mirror upstream changes or add compatibility-only branches. See ADR 1.

### Tauri IPC Is the Only Bridge

The frontend never touches the filesystem, never calls GitHub, never runs git. All external interaction goes through typed Rust Tauri commands — this is a security boundary.

### TanStack React Query Manages Server State

Backend data flows through hooks. Mutations invalidate dependent queries. Component-local state is only for UI concerns (dialog open? tab active?).

### Browser Support Floor

The frontend ships on three engines — WKWebView (macOS), WebView2 (Windows), WebKitGTK (Linux) — so "Baseline widely available" is not the bar. The bar is **Safari 16.4 / macOS 13.3**, which is what the toolchain already assumes: Vite 8's default build target is `safari16.4`, and Tailwind v4's documented baseline is Safari 16.4.

The floor has two machine-readable homes, one per axis: Vite 8's `build.target` (`safari16.4`) for the browser engine, and `bundle.macOS.minimumSystemVersion` in `src-tauri/tauri.conf.json` for the OS version. Prose must not contradict either.

Every platform feature is one of two things. **Load-bearing** — the app is broken without it, so feature-detect it or ship a fallback. **Progressive** — absence degrades instead of breaking (the theme-switch view transition and the `::-webkit-scrollbar` color fallback are progressive). Don't add a load-bearing feature above the floor without raising the floor in the same change.

## OpenSpec Workflow

The repo manages behavior-level changes through OpenSpec: open a change (proposal → specs delta → design → tasks), implement, then archive. CLI: `openspec` (v1.8+).

- `openspec/specs/` is the living truth of system behavior — behavior-level changes should sync the main specs, or the specs go stale.
- `openspec/changes/archive/` is the decision record (with verification evidence and trade-offs) — worth reading before evaluating a change.
- Project context lives in `openspec/config.yaml`; principle-level conventions are this file.
- Gate: `openspec validate --all --strict`.
- Typo-level or pure-tooling fixes don't need a change — match ceremony to stakes (see How We Work).

## Reading architecture decisions

`adr/` exists because agents over-focus on the current task and forget settled decisions: reading it at task start counters the drift, and recording when a choice settles counters the forgetting. At the start of a coding, design, or review task, if `adr/` exists, run `adrkit list`. The four folders are a context budget: read the relevant `implemented/` records in full with `adrkit show <N>` or their files; check the relevant `proposed/` records for intent and the relevant `rejected/` records for the bad cases they warn against (a rejection is durable: it leaves only when another record owns its warning); treat `archived/` as frozen history and read it only when a task explicitly cites it. Do not judge relevance by title alone: inspect tags, paths, relationships, and task scope; when a task targets specific files, `adrkit relevant <path>` retrieves the records whose `paths:` scopes govern them. For actual Git changes, use `adrkit relevant --base <review-base>` or `adrkit relevant --staged`; supplement scope matches with inventory reading for unscoped decisions and resolve incomplete-search diagnostics. Compare constraints with current code; explain conflicts or changed assumptions before choosing a different approach. Mention relevant ADR numbers and verify affected behavior. Re-read on a new or resumed task, or when scope changes. Read a `## Deliberation` appendix only when its decision is in play.

Before creating a record, compare it with the active records covering the same choice or mechanism: extend a duplicate; when the active record's mechanism is itself unsound, weigh removing it rather than patching it; for an unshipped full replacement, link its intent and keep the old authority active, then use `adrkit supersede --by` in the same change that ships and records the replacement; link a partial overlap while the older record stays active. When shipping or reviewing, keep each active record's realization facts — paths, names, defaults — aligned with shipped code; a changed choice is a new record with an explicit relationship, not a rewrite of old rationale. Archived records are ordinary Git-tracked history, never edited silently, and not read by default.

Records cost time to write, read, and maintain, and stale records can mislead; record only when preserving the rationale is worth that cost. For example, routing all writes through one boundary to preserve validation and auditing can merit an ADR: a later direct write may look locally correct while bypassing those guarantees. Routine fixes and local renames usually need none when code and tests adequately explain them.

Record an ADR when an architectural choice constrains future work and its lasting rationale or genuine trade-offs are not adequately explained by code, tests, and existing documentation. A behavior change alone does not qualify. Record genuine alternatives and trade-offs, not invented template filler. A grilling session records every choice it settles, but unshipped outcomes remain proposals. Use `adrkit propose` for unshipped work, `adrkit implement` after it ships, and `adrkit record` for an already-shipped decision. `raised-by` declares who introduced the choice; `decided-by` declares whose judgment settled it. The CLI neither infers nor verifies shipping or provenance.

Records outlive the format that wrote them. When `adrkit validate` reports unknown fields, missing sections, or parse errors on records an older release wrote, treat it as format drift rather than damage: upgrade the `adr-kit` package to the latest stable release, migrate the active records to the current format where the change is mechanical, and report any record that cannot be carried over instead of forcing a rewrite; then re-run `adrkit validate --all`. Archived records are ordinary Git-tracked history: validate checks them by the current rules; a later format change is a normal migration commit.

When the user wants to review or share the project's history, use the `adrkit-visualize` skill; generate a browsable atlas from `adr/implemented/` and `adr/archived/` only, publish archived bodies in full, and pin the page to the commit it was built from.

<!-- adrkit: standing-orders 449bd66b -->

Project gate: `adrkit validate --all`, run by `.githooks/pre-push` — CI does not cover `adr/`.

## Testing

**Run tests:**
- frontend: `bun run test`
- backend: `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`

**Test where bugs breed, skip what doesn't matter.** Only test code that would both go wrong and hurt when it does. Not thin wrappers, trivial getters, library behavior, or simple useState — these won't break, and if they do it's obvious.

**Use simple methods on complex code.** Prefer input → assert output over heavy infrastructure.

**Tests keep pace with code.** Write or update tests in the same change, don't batch for later.

**Colocate test files.** Place `*.test.ts` files next to the module they test (e.g., `src/hooks/useSkills.test.ts` alongside `src/hooks/useSkills.ts`).

## Code Quality

**Lint:** `bun run lint` (oxlint — correctness, suspicious, perf rules)
**Format:** `bun run format` (oxfmt)
**CI gates:** Lint + format check + tests run on every PR.

## Dev Server

The frontend dev server runs under Bun (`bun run dev` → `bunx --bun vite`). Vite caches pre-bundled dependencies in `node_modules/.vite`.

When `package.json` changes — a dependency added or removed, or `bun install` / `bun remove` run — that cache can go stale. The tell-tale symptom is `[vite:import-analysis] Failed to resolve import "<dep>"` for a dependency that is clearly installed in `node_modules`. Clear the cache and restart:

    rm -rf node_modules/.vite && bun run dev

Or force a one-time re-bundle with `bunx --bun vite --force`. Note that `bun install` fixes `node_modules` but does not touch the Vite cache, and a running dev server holds the stale optimizer state in memory — a full restart is required.

## Project Website

`site/` owns the public landing page. Build it independently with
`npm --prefix site ci`, `npm --prefix site run check`, and
`npm --prefix site run build`; browser regressions use `npm --prefix site test`
after installing Playwright Chromium. The desktop/CLI builds do not cover it.

Edit both languages in `site/src/i18n/ui.ts` in the same change. Preserve the
`/skill-zoo/` deployment base, `/zh/` route, old `?lang=zh/en` links, and
`site/public/version.json` as the released-version source. Release automation
updates that manifest; do not substitute the development package version.
Website deployment is `.github/workflows/site.yml`; assets live in
`site/public/`, while unrelated documentation stays in `docs/`.
