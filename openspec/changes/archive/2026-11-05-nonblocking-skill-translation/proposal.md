# Proposal

## Why

Manual translation sets the translated-view flag before any translated text exists. The content pane then replaces the readable original with a centered spinner. The user requested the genesis-project intent progress pattern so long translations do not block reading.

## What Changes

- Keep the original visible until translated body text arrives; retain existing streaming previews and old results during retranslation.
- Show a non-interactive 2px intent bar above the pane immediately while translating. Only success completes/fades the bar; failure/cancel remove it.
- Provide indeterminate native progress semantics and polite completion feedback, with static reduced-motion rendering.
- Retain the separate cached-first-read loading gate, editor source and background translation ownership.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `skill-content-translation`: readable original during initial inference and nonblocking progress feedback.

## Impact

SkillContentPane, a focused progress component, styles, bilingual completion text and real-hook UI regression tests. No backend or request lifecycle changes. Reference: genesis-project intent-link-progress, adapted to application state rather than demo timers.
