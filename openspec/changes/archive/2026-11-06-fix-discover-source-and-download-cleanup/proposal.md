# Proposal

## Why

The worth-fix audit found real skills.sh sources with dotted repository names that discovery silently filters out, and error paths that leave partial ZIP files behind. Both can be corrected locally without reorganizing discovery or installation.

## What Changes

- Accept valid dotted GitHub repository names while rejecting domain-based and malformed search sources.
- Automatically clean up each download's temporary file on errors or task cancellation, preserving unique paths and complete-cache publication.
- Add deterministic regression tests using real source parsing and a local HTTP server.

## Capabilities

### New Capabilities

- `discover-search`: GitHub source validation for skills.sh search results.

### Modified Capabilities

- `repo-zip-download`: Temporary-file cleanup for unsuccessful downloads.

## Impact

Rust discovery commands and ZIP download service only; no IPC, dependency, local protocol, installation ownership, or schema changes. Existing ADRs 1 and 3 remain intact. Audit evidence is in `docs/research/discover-download-worth-fix.md`.
