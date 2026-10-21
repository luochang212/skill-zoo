# Design

## Context

Repository metadata and README have seven-day caches on disk and in React Query. Failed network refreshes return stale disk entries without changing their timestamps. Repository searches may successfully return minimal metadata on failure.

## Goals / Non-Goals

Recover reads when credentials change and explain API failures. ZIP authentication, private repositories and automatic install/update mutations remain out of scope.

## Decisions

- Cancel repository metadata/README/search queries and invalidate them after a verified credential save. Active queries refetch immediately; inactive queries refetch on next observation. Valid backend cache entries remain valid; stale entries naturally retry the network. Do not clear disk caches or force all reads.
- Share response classification for tree, metadata and README. Preserve generic/proxy 403 as unavailable; only explicit GitHub permission headers classify permission failures. Distinguish 401, primary quota exhaustion and 429; carry effective authentication and optional retry timestamp in structured errors. Read response quota headers before falling back to runtime auth state.
- Preserve structured errors through update-check issue strings without changing persisted local protocol. Known rate limits still stop the check batch; other failures affect only their repository. Retain existing stale and ZIP README fallbacks.
- Surface read errors with existing error components and translated text. Do not automatically retry rate-limited queries.

## Risks / Trade-offs

- Credential changes can race existing reads → cancel frontend queries before invalidation so old results cannot overwrite recovered views. Refetch runs in the background so saving credentials does not wait for GitHub reads.
- GitHub may omit reset metadata → show actionable guidance without inventing a time.
- Cached offline data remains available → credential refresh does not delete cache files.

## Reference

GitHub response classification follows [permission diagnostics](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api) and [rate-limit recovery headers](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api). Non-quota proxy 403 behavior remains unchanged.
