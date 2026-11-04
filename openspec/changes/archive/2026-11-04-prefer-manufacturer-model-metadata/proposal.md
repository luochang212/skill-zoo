# Proposal

## Why

Real models.dev entries disagree for qwen3.8-flash, so unanimous cross-provider fallback suppresses a useful recommendation despite matching manufacturer records.

## What Changes

- Prefer a recognized manufacturer's matching metadata after the configured endpoint's exact match.
- Use the mode of complete limit pairs, selecting the first candidate in deterministic order when modes tie.
- Keep exact ID/namespace matching, request identity, credential isolation, manual edits and existing UI behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `llm-provider-config`: manufacturer preference and conservative modal metadata fallback.

## Impact

Rust catalog matching, regression tests and specification only. No dependencies, stored schema or additional HTTP/model requests. Manufacturer identity is an explicit model-family/catalog-provider relation, not inferred from a display name or arbitrary website.
