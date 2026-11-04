# Proposal

## Why

Existing providers are maintained as settings, but their management pane requires a separate Save action after every edit. The user wants to remove the bottom Save/Cancel buttons while retaining explicit confirmation when creating a provider or editing model parameters.

## What Changes

- Automatically persist existing-provider text fields on valid blur/rename confirmation, and discrete settings/model changes immediately.
- Replace the management footer buttons with saving/saved/unsaved/failure feedback and an explicit retry on failure.
- Serialize writes, retain newer edits across responses, and protect unsaved changes when navigating or closing.
- Keep new-provider submission and model-dialog confirmation explicit; keep connection testing independent of saving.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `llm-provider-config`: Existing-provider autosave, feedback and navigation protection replace the management-page Save/Cancel transaction.

## Impact

Frontend provider management, enclosing settings dialog, English/Chinese copy, and colocated tests. Reuses the existing save IPC and query cache updates. No backend, credential schema, dependency, or model-call changes.
