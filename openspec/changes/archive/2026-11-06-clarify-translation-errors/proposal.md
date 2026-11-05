# Why

A live translation failed with HTTP 429 and `AccountQuotaExceeded`, but the user saw only “Translation failed”. The backend conflated quota exhaustion with other request limits, and the task toast discarded even the existing safe error category.

# What Changes

Recognize the observed structured quota code on HTTP 429 in the shared classifier, including wrapped stream errors. Display the existing localized error reason in the task toast, with a generic fallback. Keep notifications brief and never display upstream messages or request IDs.

# Capabilities

## Modified Capabilities

- `llm-provider-config`: distinguish known quota exhaustion from other HTTP 429 responses.
- `skill-content-translation`: surface concise localized failure reasons in the existing task toast.

# Impact

Shared LLM classification, task notification, bilingual copy and regression tests. No request, retry, persistence or protocol changes.
