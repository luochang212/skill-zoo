# Proposal

## Why

Translation errors currently add an inline banner that shifts the document, while the retry action lives inside it. The user wants Toast-only notifications and a context action beside the translation button.

## What Changes

- Remove document translation/configuration error banners; use concise single-line Toast notifications.
- Place one icon-only action immediately after the translation split button: Stop during streaming/automatic repair, Retry after terminal failure, absent otherwise; retain tooltip and accessible names.
- Move Stop out of the dropdown; preserve retry availability checks and the ability to stop from edit mode.
- Emit terminal-task Toast from the shared session to avoid duplicate notifications. Use the already available display name as a short optional prefix captured at task start; no extra lookup, paths, models, task numbers or second-line descriptions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `skill-content-translation`: Toast error feedback and adjacent task actions.

## Impact

Translation hook, toolbar, pane, bilingual stop label and relevant tests. No backend, cache format or request lifecycle changes.
