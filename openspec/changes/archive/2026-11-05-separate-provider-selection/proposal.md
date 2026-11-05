# Proposal

## Why

The previous sidebar unification incorrectly included provider selection. The user clarified that first setup and Add service must share one standalone picker; only provider configuration uses the sidebar.

## What Changes

- Render the same provider picker without service navigation for first setup and Add service.
- Restore the sidebar after selecting any built-in or custom provider, showing the unsaved provider draft alongside existing services.
- Keep explicit creation saves, autosave for existing providers and unsaved navigation protection.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `llm-provider-config`: distinguish standalone provider selection from sidebar configuration.

## Impact

ModelProvidersSection, its UI tests and the existing specification. No persistence or IPC changes.
