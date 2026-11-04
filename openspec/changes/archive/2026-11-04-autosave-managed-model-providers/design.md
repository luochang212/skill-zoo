# Design

## Context

See proposal.md for motivation. `ProviderEditor` serves both new and existing providers; `ModelProvidersSection` currently remounts it after each save. Existing `useSaveSkillProvider` updates provider summaries and the dedicated credential query. The parent `AiSettingsDialog` owns close/back navigation.

## Goals / Non-Goals

Keep the creation flow and model parameter confirmation intact. Reuse the existing mutation/IPC; do not add a persistence protocol, dependencies, timers, or model requests.

## Decisions

- Opt existing-provider editors into autosave. Text changes remain draft-only until blur; discrete actions commit their resulting snapshot. Keep the editor mounted after successful saves so responses cannot erase subsequent typing.
- Serialize snapshots through the existing mutation using a promise chain. A saved snapshot clears dirty state only if it is still the current draft. Do not retry failed writes automatically.
- Wait for writes before navigation, including root close and back. Reuse the existing discard dialog for invalid/failed drafts. A small shared navigation ref connects the owning dialog to the existing provider guard.
- Validate on completed interaction using native form validity and backend validation. Keep field error ARIA/text feedback rather than requiring `:user-invalid`, which needs Safari 16.5 while this project supports 16.4. Disable managed controls during credential reads; never substitute an empty key when loading fails.
- Show live saving/saved/unsaved/failure text in place of management action buttons. Failed saves expose an explicit retry while keeping inputs.

## Risks / Trade-offs

- Blur followed immediately by switching/closing → synchronously register queued saves and await them before checking the latest dirty state.
- Response arrives during the next edit → compare snapshot identity, update query data but never remount or reset the editor.
- A field is invalid while another changes → keep the full provider draft unsaved, show validation feedback, and retain the last persisted configuration.

## Migration Plan

No migration; existing provider configuration and backend commands are unchanged.
