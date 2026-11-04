# Verification

Existing providers now save completed text edits and discrete changes through the existing IPC. The editor stays mounted, and snapshots are written serially. The owning dialog routes close/back through the same navigation guard as sidebar changes. New-provider submission and model-dialog confirmation stay explicit.

Component regressions cover blur-only text persistence, immediate enable/model changes, invalid-input navigation guards, preserving newer typing across delayed saves, and failure/close/explicit retry. Existing tests also verify IME cancellation, saved-key loading, connection testing, new-provider submission and translation preference isolation.

The failure regression caught an unintended retry on navigation blur; failed snapshots are now retried only on explicit retry or a new completed edit. The rename regression caught Escape dismissal reaching the owning dialog before the input handler; active rename Escape now stays within that editor.

Modern Web Guidance: `forms` and `validate-input-after-interaction` informed native constraint validation after blur and accessible textual status feedback. The implementation uses explicit ARIA state and native validity instead of requiring `:user-invalid` above the Safari 16.4 support floor.

Validation: frontend suite, focused settings regressions, TypeScript, oxlint, oxfmt, production build, OpenSpec strict validation and ADR validation. No Rust changes in this autosave change; prior protocol work remains separate in the working tree.

Limitations: no live Tauri desktop or real-provider UI session was exercised; UI behavior was verified through jsdom component interactions. No credentials or network inference were used by the tests.

Follow-up note (2026-11-04): the main spec's save-feedback wording is the final decision and is authoritative — the UI shows saving, unsaved and save-failed states, and after a successful save MUST NOT show a persistent saved hint. This change's delta wording ("distinguish saving, saved, unsaved and save-failed") was superseded during spec finalization before commit; the shipped implementation matches the main spec (no persistent saved indicator in the provider management UI). Recorded as a note rather than a rewrite of the archived delta.
