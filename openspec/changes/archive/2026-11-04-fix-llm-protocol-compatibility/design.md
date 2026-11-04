# Design

## Context

See proposal.md for motivation. Both IPC probes and translations call `services/llm.rs`, with validated trailing-slash API roots. ZCode's model-execution.ts normalizes Anthropic roots and sends both auth headers. Its OpenAI factories preserve custom roots. Its AI SDK-specific Responses JSON normalization is unnecessary if genai accepts the same compact shape.

## Goals / Non-Goals

Keep routing and authentication shared by probes and translations. Do not add provider-specific configuration, fallback retries, model-option maps, SDK wrappers, or change probe budgets.

## Decisions

- Normalize only the outgoing Anthropic root, preserving an existing case-insensitive `/v1` suffix and all gateway path segments. Persisted config remains untouched; OpenAI roots remain literal because gateways use paths such as `/api/paas/v4`.
- Send the configured key as both Anthropic authentication headers. Reuse existing Bearer assembly for all protocols; empty keys still produce no auth headers.
- Classify typed SDK response/parse errors as providerResponse, including nested stream errors. Never inspect or stringify provider message text to derive categories. Preserve HTTP status classification and timeout handling.
- Lock down Chat Completions modern-model budgets, custom routes, reasoning/usage chunks, Responses compact JSON, anonymous requests, and stream failures through the real SDK and mock HTTP servers. Keep SDK behavior that already works rather than porting ZCode's Vercel-specific repairs.

## Risks / Trade-offs

- Gateways with nonstandard Anthropic paths may not use `/v1` → match ZCode's explicit gateway-root convention and test both root and versioned forms.
- Provider-specific errors inside a successful SSE response lack reliable HTTP status → return providerResponse without guessing from echoed text.
- Offline tests cannot certify the user's account/endpoint → report this limitation; never expose or require credentials for regression tests.

## Migration Plan

No migration or dependency upgrade. Rollback is the Rust patch; stored connections remain readable.
