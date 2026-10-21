# Design

## Context

See proposal.md. Existing API-sourced README caches use a seven-day TTL, and credential saves invalidate React Query reads without forcing valid disk caches to expire.

## Decisions

Persist ZIP fallback content with `fetched_at: 0`, so it remains available offline but cannot satisfy the API freshness check. Preserve successful API timestamps and existing stale-cache fallback behavior. No refactor is needed.

The regression spawns an isolated test subprocess with a local failing HTTPS proxy. This exercises the real `get_repo_readme` command and credential slot without changing global proxy variables in other tests or introducing production test hooks.

## Risks / Trade-offs

Entries already written by older versions cannot be distinguished from genuine API entries because their persisted fields are identical. Do not erase valid caches or add a migration solely to guess their source: existing manual force refresh or TTL expiry recovers those entries. Newly written ZIP fallbacks remain retryable. Repeated reads still use frontend caching; an explicit refetch or remount after invalidation may retry the API while preserving offline content.
