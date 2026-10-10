# Verification

Verified against the repository on 2026-10-09 before archival.

- `src-tauri/src/commands/settings.rs` persists visibility before best-effort link cleanup, returns a cleanup warning flag, and rejects only growth beyond the visible-agent cap.
- `src-tauri/src/services/skill.rs` limits cleanup to SSOT targets or registered skill homes and retains foreign links. Existing tests cover ownership, dangling links, staging rollback, cross-volume rename failure, read-only paths, and visibility boundaries.
- `src/hooks/useSettings.test.tsx` covers the cleanup-warning toast and silent-success paths; the frontend suite passed (157 tests).
- The full Rust suite, CLI suite (100 tests), frontend/CLI/Vite-config type checks, frontend lint/format check, CLI build, and Rust clippy all passed.
- All five requirements and their scenarios were synced to `openspec/specs/agent-visibility/spec.md` and validated with OpenSpec 1.14.1 before archival. No local protocol files or fixtures were changed.

This verification uses source inspection and automated tests; it does not claim a new manual GUI or real mounted-volume experiment. The frontend test runner reports an existing Vite native-config warning about `__dirname` in `vitest.config.ts`; tests pass.
