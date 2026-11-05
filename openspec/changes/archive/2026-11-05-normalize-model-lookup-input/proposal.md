# Proposal

## Why

Component probes confirmed that changing only surrounding whitespace clears matched limits, and that an unfinished IME composition can start metadata lookup after 400ms. Both are small input-identity defects.

## What Changes

- Compare the trimmed model ID for lookup identity and parameter reset.
- Suspend lookup during composition and start the debounce when composition finishes.
- Preserve existing matching, manual-value protection and focus/blur behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `llm-provider-config`: normalized model identity and composition-aware lookup timing.

## Impact

ModelEditorDialog and two regression tests. No backend, persistence or network policy changes. Tests failed on the original implementation and pass after the fix; native IME interaction remains unverified.
