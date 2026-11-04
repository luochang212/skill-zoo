# Design

## Context

The current exact provider/full ID tier already preserves endpoint-specific limits. All global candidates currently must agree, which rejects qwen3.8-flash because Alibaba and several gateways publish different limits. models.dev has provider IDs and model families, but no uniform authoritative manufacturer field.

## Decisions

Recognize a bounded explicit relation between established catalog provider IDs and model-name families (Qwen/Alibaba, GLM/Z.AI and Zhipu, Claude/Anthropic, GPT and o-series/OpenAI, DeepSeek, Kimi/Moonshot, MiniMax). Other families get no inferred manufacturer. Never use a provider display name or arbitrary URL as proof of ownership.

Use five tiers: endpoint + full ID, manufacturer + full ID, manufacturer + exact final ID segment, global full ID, global final ID segment. Valid manufacturer candidates are preferred over global candidates. Unusable manufacturer entries allow global fallback; unusable endpoint-specific entries still stop lookup. Within each populated tier, the most common valid complete pair wins.

For global fallback, count complete valid (context, output) pairs. A single candidate remains usable. Ties (including all-singleton candidates) use the first valid candidate among the top-frequency pairs in the existing deterministic catalog iteration order, rather than numeric limit order. Count an ID entry once, ignore unusable limit pairs, and never synthesize a pair by voting fields independently. A populated global full-ID tier still cannot fall through to weaker leaf matching.

## Risks / Trade-offs

Directory entries are not independent votes; ties provide an editable starting value at the user's explicit request. Gateway limits can differ from the model's manufacturer. Values remain editable recommendations only. Explicit manufacturer relations require additions for new makers; unknown makers safely use fallback instead of speculative ownership. No public URL/model rewrite or model request occurs.

## Migration Plan

No persistence/cache-schema changes. Existing downloaded catalogs are sufficient; only lookup policy changes.
