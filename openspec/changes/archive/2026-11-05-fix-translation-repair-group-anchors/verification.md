# Verification

## Confirmed and worth fixing

The defect is confirmed by a captured real DeepSeek failure and a deterministic production-function regression. It is a medium-severity translation failure and wasted-token issue, not demonstrated corruption of source skill files. A local repair is sufficient; no translation state-machine redesign is needed.

## Red → green

`repair_preserves_an_intact_reordered_group_when_frontmatter_is_missing` first failed on the old implementation: even healthy reordered text produced a repair plan. The offline production bridge additionally demonstrated duplicated markers after identity repair. Both now pass: one repair fragment and exactly one copy of every marker, with the healthy output group preserved.

The second Rust regression exhaustively covers 625 four-slot marker sequences (missing, duplicate and displaced markers); identity repair must produce a globally valid result without duplicates. Existing frontmatter, code fences, cross-line ordering, repair, fragment and cache tests pass.

## Live evidence

The same captured continue-change first response now receives one targeted repair instead of two fragments. A real non-thinking DeepSeek call completed and restored successfully in about 1.71 seconds with 411 tokens (previous two-fragment repair used 708 and failed). No extra retry was added. `fixed-repair.json` retains the corrected plan, response, splice and restored result.

Two new whole-document requests for update-change and continue-change also completed and restored on the first response, using 6,192 and 6,052 tokens. They are recorded in `fixed-live.json`; they do not establish a universal model success rate.

## Checks

- Full `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`: passed, including 297 library tests and integration suites; existing two performance probes remain ignored.
- `cargo clippy --features test-helpers --manifest-path src-tauri/Cargo.toml -- -D warnings`: passed.
- Cargo/rustfmt and `git diff --check`: passed.
- OpenSpec strict and ADR validation: passed; main translation specification synced before archive.
- No frontend code changed, so frontend tests were not rerun. No source skills, user configuration or caches were modified by the investigation scripts.

## Limits

The model may still omit or damage markers, and a single repair can still fail. This change removes our deterministic duplicate-splicing bug while retaining integrity checks and the one-round limit. UI rendering and cross-provider live behavior were not retested.
