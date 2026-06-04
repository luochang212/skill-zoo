# AGENTS.md

Read `CLAUDE.md` first. This file adds agent-specific guardrails and does not replace the full project guide.

## Project Layout

- **Desktop app** — `src-tauri/`
- **CLI** — `packages/cli/`

## Local Protocol Guardrails

The desktop app owns Skill Zoo's local protocol. The CLI is an adjunct control surface that must conform to desktop-owned local state; it must not define an independent schema or change protocol fixtures for its own convenience.

Protocol-impacting work includes changes to desktop-owned local state shape, paths, schema versions, lock/archive write semantics, or user-visible compatibility and migration behavior. When such work is intentional, update the local protocol document, desktop protocol fixtures, and both CLI and Rust protocol tests in the same change.

The fixtures under `fixtures/local-protocol/` represent the desktop app's current protocol. If a CLI fixture test fails, fix the CLI to follow the desktop protocol unless the desktop protocol itself intentionally changed.

