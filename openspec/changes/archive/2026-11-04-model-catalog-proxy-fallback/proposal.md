# Proposal

## Why

Provider-address-only catalog matching misses Coding Plan endpoints and proxies, even when their model ID is present in the public catalog.

## What Changes

- Prefer exact provider and ID, then full ID across providers, then exact leaf ID after namespace removal.
- Accept multiple candidates only when their usable recommended limits agree; stop on ambiguity in a stronger tier.
- Preserve request identity, manual input, fetching and cache behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `llm-provider-config`: deterministic cross-provider metadata fallback for proxy and plan endpoints.

## Impact

Rust catalog lookup, colocated tests and specifications only. No new dependencies, network requests, model calls or configuration schema changes.
