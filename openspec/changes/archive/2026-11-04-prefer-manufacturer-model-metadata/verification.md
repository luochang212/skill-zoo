# Verification

## Reproduction and source evidence

The original manufacturer-priority regression failed: qwen3.8-flash on an unknown proxy returned None despite valid Alibaba metadata. The initial manufacturer-priority fix passed ten catalog regressions. The final user-directed policy also selects the first valid candidate on ties, including all-singleton candidate lists.

The public models.dev API was inspected on 2026-11-04. Its Alibaba and Alibaba China qwen3.8-flash entries both report context 1,000,000 and output 131,072; Hyper and Requesty publish different pairs. The catalog has no uniform manufacturer-ownership field, so provider display names are not used to infer ownership. Values remain supplied by [the public catalog](https://models.dev/api.json), not hardcoded production defaults.

## Covered behavior

- Current endpoint limits override manufacturer/global recommendations.
- Manufacturer recommendation wins even when more gateway entries vote for a different pair; regional manufacturer ties are resolved within that priority tier.
- Bare and namespaced Qwen IDs use the same original-manufacturer record without modifying request identity.
- Unknown manufacturers use the mode of complete pairs; ties and all-singleton conflicts select the first valid candidate in deterministic traversal order, not numeric order.
- Independent context/output voting cannot synthesize a pair absent from the catalog.
- Unusable original-manufacturer metadata allows modal fallback, while invalid configured-endpoint metadata is not bypassed.
- Existing exact identity, namespace, near-model rejection and anonymous bounded-download tests remain intact.

## Limitations

No live provider credentials or model inference were used. Catalog recommendations cannot certify the limits enforced by a user's gateway. Existing empty-field and manual-input protections are unchanged. No frontend tests are needed for the Rust-only selection change.

## Final checks

The final user-approved tie policy passed all 11 catalog tests and the full backend suite (281 unit tests plus integration tests; two existing performance tests remain ignored by default). Rust Clippy with `-D warnings`, rustfmt check, OpenSpec strict validation, ADR validation and `git diff --check` passed. The main specification was synchronized before archive. No frontend or real-provider UI session was exercised for this Rust-only policy change.
