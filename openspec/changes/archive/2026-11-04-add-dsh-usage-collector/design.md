# Design

## Context

The `skill-usage` collector registry (see `src-tauri/src/services/skill_usage.rs`) maps one `agent_id` to one collector function; `dsh` already exists as an agent in `config.rs` and lights up automatically once `supports_agent("dsh")` returns true. DeepSeek Harness session storage was investigated against 75k+ decompressed lines from this machine's real `~/.dsh/sessions`: records are JSON events with a top-level `time` (ms epoch), stored as Zstandard-compressed JSONL under `sessions/<cwd-slug>/<session-dir>/session.vN.jsonl.zstd`, with two coexisting layouts (files directly in the session dir and nested one level deeper — a recursive walk covers both). Skill loads surface as `user/message` records whose text starts with `<skill_content name="…">`; `tool/ptc-dispatch` (+ its `-start` mirror) records carry the loading tool call, and `skill-catalog` listings enumerate available skills.

## Goals / Non-Goals

**Goals:**

- Count every verified skill load in dsh sessions, including files stored under older format versions.
- Keep the collector thin: line-level marker matching, no format-migration machinery.

**Non-Goals:**

- Reproducing dsh's versioned format catalog (v0→v4 codecs) — a full-fidelity concern this feature does not have.
- Distinguishing user-slash from model-initiated loads in dsh (v1 attributes all loads as agent-initiated; revisit if a reliable discriminator surfaces).
- Reading uncompressed `compression: 'none'` roots — none exist on this machine; the line scan would handle them anyway if the extension check is kept loose.

## Decisions

**Count the injection, not the dispatch.** A skill load produces both `tool/ptc-dispatch` records (the loading call, plus a `-start` mirror) and the `user/message` skill-content injection — two views of one event. Only the injection counts: it carries the skill name in a deterministic marker, it is what actually entered the model's context, and counting it alone makes the dispatch-mirror dedup problem (the exact trap that bit Codex) structurally impossible. Skill-catalog listings use different text (`<available_skills>`), so the `<skill_content name="` prefix filter separates enumeration from usage.

**Version-agnostic line scanning.** Each record line is self-describing JSON (`type`, `time`, `data`); the version suffix in the filename only matters to consumers that need historical-codec translation. Scanning decompressed lines for the marker and reading `type`/`time` fields works across versions, so format drift in unrelated event types cannot break the collector — and the archived Codex sentinel pattern (warn when files reference skills without yielding events) can be extended here later if needed.

**New `zstd` dependency, latest stable.** There is no uncompressed fallback on real installs: the default encoding is Zstandard frames. The `zstd` crate (bundled build) is the only decompression path in Rust; decompress per file into a line stream, keeping peak memory bounded like the existing JSONL collectors. Decompression failure skips the file per the robustness requirement.

**Discovery mirrors the other collectors.** A recursive walk of `~/.dsh/sessions` collects `session*.jsonl.zstd` files (both observed layouts), then each file goes through decompress → line parse → whitelist filter, reusing the shared aggregation path. Each injection is one event with no dedup id: injections appear once per session file in the sampled data, and seeded sessions inherit history within the same file rather than duplicating it across files.

## Risks / Trade-offs

- [dsh attribute semantics could differ for user-slash loads] → All v1 events count as agent-initiated; the User/Agent breakdown for dsh is conservative rather than wrong, and the assumption is recorded in the proposal for review.
- [New dependency weight] → `zstd` is a single, widely-used crate with a bundled build; it earns its keep because compressed session files are the only real-world encoding.
- [Format generations beyond v4 may change the injection shape] → Marker matching is version-agnostic by construction; if the marker itself moves, the failure mode is visible undercounts, and the sentinel extension is a known pattern away.

## Migration Plan

No data migration (read-only collection). Rollback is reverting the commit; the `zstd` dependency goes with it.

## Open Questions

None — record shapes, layouts, and compression were verified against real local sessions before this proposal.
