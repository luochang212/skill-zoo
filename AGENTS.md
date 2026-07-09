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

## What This Project Is

A desktop app for managing AI coding assistant Skills. Users browse, install, create, and manage Skill files across multiple agents (Claude Code, Codex, Gemini, Cursor, etc.).

Core insight: a Skill is a file. This app is essentially a file manager with a purpose-built UI.

## Project Layout

- **Desktop app** — `src-tauri/`
- **CLI** — `packages/cli/`

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
- Install preflight must check SSOT plus currently visible agent directories, not every known agent directory.

This prevents hidden agents or external import records from creating conflicts that users cannot find on the Local page, while preserving external imports as manageable entries.

### Local Protocol Guardrails

The desktop app owns Skill Zoo's local protocol. The CLI is an adjunct control surface that must conform to desktop-owned local state; it must not define an independent schema or change protocol fixtures for its own convenience.

Protocol-impacting work includes changes to desktop-owned local state shape, paths, schema versions, lock/archive write semantics, or user-visible compatibility and migration behavior. When such work is intentional, update the local protocol document, desktop protocol fixtures, and both CLI and Rust protocol tests in the same change.

The fixtures under `fixtures/local-protocol/` represent the desktop app's current protocol. If a CLI fixture test fails, fix the CLI to follow the desktop protocol unless the desktop protocol itself intentionally changed.

### Compatibility with `npx skill`

`CliService` is a native Rust reimplementation of the `npx skill` CLI (vercel-labs/skills v1.5.3) — the app no longer shells out to it. We must stay at least on par with the CLI and remain compatible where possible, since users may use both. Watch for upstream changes and mirror them.

### Tauri IPC Is the Only Bridge

The frontend never touches the filesystem, never calls GitHub, never runs git. All external interaction goes through typed Rust Tauri commands — this is a security boundary.

### TanStack React Query Manages Server State

Backend data flows through hooks. Mutations invalidate dependent queries. Component-local state is only for UI concerns (dialog open? tab active?).

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
