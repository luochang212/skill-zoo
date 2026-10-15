# Proposal

## Why

SSOT cache IDs include mutable repository provenance, so source changes or missing locks detach user flags. Desktop and CLI also disagree on malformed sources. User metadata must survive these derived identity changes without guessing ownership.

## What Changes

- Address SSOT flags by normalized installation-relative directory; retain other origins' IDs and existing cache IDs.
- **BREAKING**: promote metadata.json to explicit v1, conservatively migrate legacy entries once under the shared lease, and refuse future-version writes.
- Align CLI source parsing with desktop; use stable metadata keys throughout create, delete, merge, archive and restore.
- Preserve and report unbound legacy records and provide an explicit manual resolution surface.
- Add desktop-owned protocol fixtures and Rust/CLI behavior tests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-protocol`: stable user metadata identity, migration and compatibility contract.

## Impact

Rust persistence/services/commands, companion CLI protocol/store/scan/archive and manual metadata resolution; docs/local-protocol.md and shared fixtures. No dependencies, shared lock schema changes, cache ID changes, A2 reconciliation or E1 rollback.
