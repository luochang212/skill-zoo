# Why

Skill Zoo sent no thinking controls for Volcengine Coding Plan GLM-5.3-Flash. A live request returned reasoning and hit the 180-second total limit without prose. A later explicit `reasoning_effort=low` experiment began prose after 1.65 seconds and completed in 40 seconds, confirmed by the user. That later input was smaller (8,826 versus 20,036 bytes), so these observations do not establish a controlled speed comparison or a guarantee for the larger document.

The editor also displayed this fixed-thinking model as off because its capability query returned only whether thinking could be toggled. The provider documents fixed thinking and a default max effort for the versioned model.

# What Changes

Use explicit light reasoning for the verified Coding Plan Chat Completions model aliases. Return a typed thinking-control mode so the existing switch can show a known fixed-thinking model as on and disabled. Keep user preferences and all timeouts intact. Remove temporary experiments and diagnostic logging.

# Capabilities

## Modified Capabilities

- `llm-provider-config`: distinguish toggleable, known always-on and provider-default behavior internally without adding UI status text.

# Impact

Shared LLM options, one private IPC query, existing editor switch and tests. No saved schema changes, automatic requests, retries, extra settings or timeout changes.
