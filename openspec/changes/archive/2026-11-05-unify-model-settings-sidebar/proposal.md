# Proposal

## Why

Model management currently changes its layout when creating a service, forcing users between a sidebar editor and a standalone form. The user wants one consistent sidebar interface.

## What Changes

- Keep the service navigation and Add service action visible during first setup, template selection and new-service editing.
- Keep one Model management dialog title and layout across all service flows.
- Move creation state and its explicit-save footer into the existing service manager; remove standalone creation routes.
- Use the existing navigation guard for switching, closing or canceling an edited new-service draft.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `llm-provider-config`: unified sidebar presentation for initial setup, creation and editing.

## Impact

AiSettings dialog, ModelProvidersSection and UI tests. Connection validation, credentials IPC, persistence and translation preferences stay under their existing owners.
