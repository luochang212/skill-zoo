# Tasks

## 1. Preserve settings

- [x] 1.1 Restore legacy-key fallback; verify old/new/conflicting/default choices with real hooks and preserve bytes through desktop/CLI protocol fixtures. Document the read precedence in docs/local-protocol.md.

## 2. Protect prepared updates

- [x] 2.1 Carry per-item overwrite consent to replacement; verify preflight-clean/later-edited content survives, explicit force still replaces, and skipped baselines remain unchanged with production-path Rust tests.
- [x] 2.2 Propagate late skips through single/batch results; verify single confirmation and accumulation of early/late skips by code-path review and Rust tests.

## 3. Preserve results and actions

- [x] 3.1 Retain unfinished checked candidates in React Query; verify mixed clean/forced/skipped/failed actions without a network recheck in component tests.
- [x] 3.2 Move skip summaries to the global notification; verify one localized notification after initiating hook unmount, preserving successes/failures and skipped names.

## 4. Integration

- [x] 4.1 Run frontend/backend/CLI tests, type/lint/format checks, strict OpenSpec and ADR validation. Record exact evidence and scope limitations in design.md.

## Workflow follow-up

- Sync affected main specs and archive the completed change; verify the archive and main specs with strict validation.
