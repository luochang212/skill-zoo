# Verification

## Behavior and evidence

The new proxy/plan regression failed on the original implementation: lookup returned None for a model registered under a different endpoint. The first five catalog tests passed after adding ordered fallback. The final suite adds unusable-limit coverage as well.

Fixtures exercise provider-specific precedence, global complete IDs, namespaced IDs, identical recommendations across providers, conflicting limits, invalid stronger candidates, unknown IDs, and near-but-different flash/flashx/version IDs. Existing bounded anonymous-download and malformed-response tests remain in place.

The matcher returns metadata only. It never rewrites the supplied ID/address, invokes a provider, or alters saved settings. Existing UI rules for empty fields, manual edits and stale responses are unchanged.

## Scope and limitations

No frontend or backend persistence API changes. No live Coding Plan/proxy credentials were used. Catalog fixtures verify the matching mechanism; actual catalog coverage and a provider's enforced limits can differ from the recommended metadata. Recommendations remain editable.

## Final checks

- Full backend suite passed: 276 unit tests plus integration tests; two pre-existing performance tests remain ignored by default. All 6 catalog tests passed.
- Rust Clippy with `-D warnings`, rustfmt check, `git diff --check`, OpenSpec strict validation and ADR validation passed.
- Main provider spec synchronized. Frontend tests were not rerun for this Rust-only lookup change.
