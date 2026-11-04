# Design

## Context

Catalog lookup currently requires exact API identity before checking model IDs. The UI treats results as editable metadata and already protects manual edits and stale results.

## Decisions

Use three ordered tiers in the existing lookup: provider plus full ID, global full ID, global final path segment. Compare full recommendation structs, including missing values. Multiple identical recommendations are safe; conflicting or unusable candidates stop resolution for that tier. Exact leaf equality avoids interpreting flash, turbo or version changes as aliases. Keep existing validation of positive bounded limits and output <= context.

## Risks / Trade-offs

A proxy may impose different limits than the public model. Recommendations remain editable references, not proof of account capability. Conservative conflict rejection sacrifices some matches rather than choosing arbitrary provider limits. No maintained provider aliases, regex rules or runtime model changes are introduced.

## Migration Plan

No persisted changes; existing catalog cache remains valid. Revert lookup to roll back.
