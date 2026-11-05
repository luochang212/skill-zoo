# Proposal

## Why

The user wants a smaller maintained provider selection: OpenAI, DeepSeek and Volcengine. Existing saved services remain user-owned configuration.

## What Changes

- Replace Anthropic, ZCode and Moonshot presets with Volcengine, keeping OpenAI, DeepSeek and Custom.
- Pre-fill Volcengine with OpenAI Chat Completions and https://ark.cn-beijing.volces.com/api/v3/ per official Ark API compatibility documentation.
- Preserve saved providers, credentials and generic protocol support.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `llm-provider-config`: a smaller built-in template selection.

## Impact

Provider template data, related UI tests and specification. No backend, persistence or migration changes. Endpoint reference: https://console.volcengine.com/ark/region%3Acn-beijing/docs/integrate-third-party-tools . No real provider credentials were used.
