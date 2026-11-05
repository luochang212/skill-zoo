# Why

A Volcengine Coding Plan Messages probe returned a successful response with an unsigned thinking block. The SDK rejected the missing signature before our connectivity checks ran, so the UI incorrectly reported provider rejection. A live diagnostic and a local mock reproduced the same decode failure.

# What Changes

Validate the captured raw response envelope even when the SDK cannot decode optional content. Keep the existing terminal-state, timeout, HTTP-error and credential-protection checks. Remove temporary diagnostics.

# Capabilities

## Modified Capabilities

- `llm-provider-config`: connectivity probes tolerate unsigned thinking when the response envelope and terminal state are valid.

# Impact

Only connectivity probe response handling and colocated Rust regressions. No request, configuration, translation or credential changes.
