# Proposal

## Why

Physical installation directories and original shared lock keys can differ. Independent name fallbacks currently attribute, update or remove the wrong record and fail to surface competing evidence.

## What Changes

- Resolve physical installations against all lock candidates using directory inventory and corroborated GitHub repo/path evidence.
- Separate installation directory from original lock key across scans, updates, Check, editing, deletion and archive lifecycle.
- Refuse ambiguity before side effects, revalidate after network preparation, preserve restore conflicts and operation-local rollback state.
- Keep existing formats and C2 guards; introduce no migration, rekey, ledger or file relocation.

## Capabilities

### New Capabilities

### Modified Capabilities

- `local-protocol`: common installation association and exact-key lifecycle semantics.

## Impact

Rust lock/skill/update/command services, companion CLI protocol scanning/archive code, desktop-owned fixtures and both conformance suites. Lock v3, archive v1 and metadata v1 remain unchanged under an explicit no-storage-migration read/refusal compatibility revision. Check skillName denotes the physical directory.
