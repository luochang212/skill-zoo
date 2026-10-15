# Proposal

## Why

Replacing local files with repository files strips gh-injected provenance from shared SSOT installations. Refuse these updates until preservation is supported, preventing further loss without inventing installer ownership.

## What Changes

- Strictly inspect local YAML frontmatter and refuse tracking or unreadable targets before network work.
- Retain a per-operation physical target and byte snapshot, rejecting observed changes before replacement.
- Surface existing update issues and exclude issue-bearing frontend candidates.
- Document unchanged storage versions and verify desktop guards plus CLI scanning/archive preservation with shared fixtures.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-protocol`: protect reserved provenance during desktop updates and preserve skill bytes across CLI lifecycle operations.

## Impact

Rust update commands/services, Check, update manager filtering/translations, desktop-owned local protocol fixtures and tests. Uses existing serde_yaml; no new dependencies, schema, registry or migration. B1 association resolution and C1 provenance reconstruction are excluded.
