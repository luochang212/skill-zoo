# Decision

A connection probe needs a successful protocol envelope and terminal state, not a decoded assistant message. Reuse the SDK request construction, extract its captured raw response from either a successful result or `ChatResponseGeneration`, and apply the same existing envelope validation. HTTP failures still fail before this validation; missing content arrays and failed or missing terminal states still fail. No second request is sent.

Changing the gateway, model, output budget or translation parser would not address this observed non-streaming decode failure. A provider-specific signature patch would duplicate SDK content parsing unnecessarily.

# Verification

A local mock must first reproduce the failure, then pass unsigned/missing-signature responses while rejecting HTTP failures and invalid envelopes. Run the existing LLM service suite and strict spec validation. Live verification requires a user-triggered probe.
