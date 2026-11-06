# Decision

Keep the backend authoritative for capability and wire parameters. Match only HTTPS host `ark.cn-beijing.volces.com`, path `/api/coding/v3` (optional trailing slash), OpenAI Chat Completions and exact model IDs `glm-5.3-flash` / `glm-5-3-flash-260828`. These fixed-thinking translation profiles send `reasoning_effort=low`; they do not pretend to disable reasoning. Unknown hosts, protocols, routes and aliases retain their current behavior.

Replace the boolean private capability query with `toggle`, `alwaysOn` or `providerDefault`. The UI keeps one switch: normal controls use the saved boolean preference; known always-on controls render checked and disabled. Reading capability must not mutate the saved preference. Pending, unknown and failed queries stay quiet and disabled; identity changes must discard stale answers.

The ordinary request builder supplies the same options to translation and its repair round. The minimal connection probe retains its one-token budget and uses light reasoning for this fixed profile. Existing valid cached translations remain readable; no cache format or configuration schema changes are needed.

# Alternatives

Increasing the total timeout alone would delay failure without correcting the missing parameter. Sending `thinking=disabled` conflicts with the documented fixed-thinking model. A universal field across all providers would violate existing capability guards. A new intensity selector is outside this fix.

# Evidence

Official capability and default-effort table: https://ark.volcengine.com/region:cn-beijing/docs/deep-thinking . The live low-effort result establishes that this route can translate; the original larger document still needs a like-for-like live check. Verify the matching predicate, actual SDK serialization and switch behavior with local tests; do not automatically run new inference calls.
