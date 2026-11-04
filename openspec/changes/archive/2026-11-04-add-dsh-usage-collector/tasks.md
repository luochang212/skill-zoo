# Tasks

## 1. Dependency and collector skeleton

- [x] 1.1 Add the latest stable `zstd` crate to `src-tauri/Cargo.toml` and verify `cargo build --manifest-path src-tauri/Cargo.toml` succeeds with it.
- [x] 1.2 Register the `dsh` collector entry pointing at `~/.dsh/sessions`, with recursive discovery of `session*.jsonl.zstd` files (covering both observed layouts: files directly in the session dir and nested one level deeper); unit test builds a temp-home with both layouts and asserts the discovered file set.
- [x] 1.3 Implement compressed-file reading: decompress each file into a line stream, skip files that fail to decompress, and reuse the shared aggregation path; unit tests cover a valid `.zstd` fixture (compressed with the crate at test time), a corrupt file that must be skipped, and an uncompressed `session.jsonl` that is still parsed if present.

## 2. Injection parsing

- [x] 2.1 Implement the dsh line parser: user-message records whose text starts with `<skill_content name="…">` yield one agent-initiated event named from the marker, timestamped from the record's top-level `time`; unit test feeds a real-shaped record and asserts the event.
- [x] 2.2 Implement the exclusions: skill-catalog listings, non-user-message records mentioning the marker, and `tool/ptc-dispatch` records are ignored; unit tests feed each shape (catalog sample, assistant mention, dispatch pair plus injection) and assert exactly one event for the injection.

## 3. Integration verification

- [x] 3.1 Run the full backend suite `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` and verify no regressions.
- [x] 3.2 Run `cargo fmt --check` and `bun run lint` and verify the tree is clean.
- [x] 3.3 Live-data smoke: point discovery at the real `~/.dsh/sessions` via a temporary test (deleted after the run) and confirm non-zero attributed events consistent with the investigation (worth-fix injections present in sampled sessions).

## Workflow follow-up

- Sync the delta into `openspec/specs/skill-usage/spec.md` on archive (MODIFIED store list and robustness, ADDED dsh events requirement).
- Archive the change after the project's review requirements are satisfied.
- Verify the archived result.
