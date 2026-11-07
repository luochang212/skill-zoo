# Verification

- Red: `bun run test src/components/skills/SkillContentPane.translation.test.tsx` — 1 failed, 7 passed. The real retranslation menu sent force=true and cache reads stayed at one, but the new preview heading never appeared.
- Green: hook and real detail-pane tests — 39 passed. Covers manual and cache-loaded translations, force flag propagation, no second cache read, partial previews, successful completion, blank previews, failure and cancellation restoring the previous successful result.
- Backend production-path check: `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml --lib production_pipeline_caches_only_success_and_keeps_original_files` passed. This uses a mock HTTP server: ordinary requests may return the saved cache; forced retranslation makes a fresh HTTP request and preserves the old cache on truncation. No backend behavior changed.
- Typecheck, lint, format check, strict OpenSpec validation, ADR validation and diff whitespace check passed.
- Full frontend: `bun run test` — 48 files, 443 tests passed.
- History check: c8e2b02^ already contained else if (!previous), so the preview suppression predates the default-cache switch removal. The default-cache change makes this old-result display path more common.
- No paid inference or desktop runtime reproduction was performed. Existing progress-bar color edits are preserved separately.
