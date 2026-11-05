# Proposal

## Why

The user wants editing to stay quiet instead of showing a persistent unsaved-changes message in the provider editor footer.

## What Changes

- Remove the draft-only footer status and the now-unused rendering state.
- Preserve autosave, saving/failure feedback, retry and the ref-based leave guard.
- Align the existing autosave requirement with the previously implemented automatic creation flow and absence of a persistent saved status.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `llm-provider-config`: silent draft state in the editor footer.

## Impact

Provider editor presentation and its existing invalid-draft navigation regression. No persistence changes.
