# Proposal

## Why

Anthropic-compatible gateway roots currently receive `/messages` without the required `/v1` prefix, and gateways requiring Bearer authentication receive only `x-api-key`. Comparing ZCode also exposed misleading network errors for provider stream failures; existing happy-path tests do not cover these cases.

## What Changes

- Normalize Anthropic gateway roots at request time and send the same configured key in both authentication headers.
- Preserve OpenAI-compatible custom API roots and protocol-specific token budgets; verify modern Chat Completions and compact Responses shapes against the existing Rust SDK.
- Classify provider stream errors and malformed responses safely, without exposing upstream payloads or retrying.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `llm-provider-config`: Define protocol routing/authentication and safe provider stream failure classification shared by probes and translations.

## Impact

Changes are limited to the Rust LLM connection layer, colocated regression tests, and the provider specification. No dependencies, persisted schema, frontend controls, or local skill protocol change.
