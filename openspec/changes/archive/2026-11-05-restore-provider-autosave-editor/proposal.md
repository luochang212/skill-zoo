# Proposal

## Why

The previous change reused the standalone creation form inside the sidebar. The user wants the original sidebar editor, including click-to-rename, three-dot deletion and automatic saving, for every provider configuration. Provider-card names also need stronger typography.

## What Changes

- Delete the standalone name-input form and Save/Cancel footer; new and existing providers share the original editor.
- Automatically persist a new provider on its first valid completed edit, then reuse its returned identity for queued and later edits without remounting its draft.
- Preserve no-write-on-open, invalid-draft protection, ordered saves, explicit retry and deletion confirmation.
- Increase provider card names from 12px to 16px with semibold weight.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `llm-provider-config`: one autosaving provider editor for both new and saved connections.

## Impact

ModelProvidersSection, provider/translation UI tests and affected requirements. Backend validation, credential IPC and storage schema are unchanged.
