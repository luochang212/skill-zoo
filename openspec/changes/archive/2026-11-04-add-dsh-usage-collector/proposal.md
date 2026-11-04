# Proposal

## Why

DeepSeek Harness (`dsh`) is one of the daily-driver agents on this machine — `~/.dsh/sessions` holds 29 project directories with sessions written as recently as November 2 — and the app already manages its skills (`dsh` agent entry in `config.rs`), but Usage Habits collects nothing from it. The session format was investigated against real local data: skill loads are recorded as conversation events whose text carries a deterministic `<skill_content name="…">` marker, so a collector can be built on verified shapes instead of guesswork — the exact discipline whose absence let the Codex collector silently break.

## What Changes

- **Add a `dsh` collector**: scan `~/.dsh/sessions` recursively for `session*.jsonl.zstd` files, decompress, and attribute one agent-initiated usage event per user-message record whose text starts with the `<skill_content name="…">` marker, whitelist-filtered as usual.
- **New dependency `zstd`** (Rust crate): session logs are Zstandard-compressed; no other decompression path exists. The collector decompresses per file and scans lines — it does not implement dsh's versioned format-migration machinery (v0→v4 and counting), which only full-fidelity consumers need.
- **Companion agents stay silent in the UI**: the `dsh` agent's `has_usage_tracking` flips on automatically via the existing `supports_agent` registry — no frontend change.

Assumptions recorded for review: skill loads are attributed as agent-initiated (the injection is harness/model mechanism; user-slash loads cannot yet be reliably distinguished, so dsh contributes no User-source events in v1); the `tool/ptc-dispatch` records that pair with an injection are the same load event and are therefore not counted separately.

## Capabilities

### New Capabilities

<!-- None: this change extends the existing skill-usage capability. -->

### Modified Capabilities

- `skill-usage`: the per-agent store list gains DeepSeek Harness (`~/.dsh/sessions`); a new requirement defines dsh usage events (injection marker, catalog/dispatch exclusions); the robustness requirement gains compressed-file decompression failure.

## Impact

- `src-tauri/src/services/skill_usage.rs` — one new collector entry + parser + session-file discovery (compression-aware), plus tests.
- `src-tauri/Cargo.toml` — `zstd` dependency added.
- No frontend changes: `SkillUsage` IPC shape unchanged; `supports_agent("dsh")` starts returning true and the UI lights up through the existing path.
- No changes to other agents' collectors; OpenCode stays absent per the archived 2026-11-04 change.
