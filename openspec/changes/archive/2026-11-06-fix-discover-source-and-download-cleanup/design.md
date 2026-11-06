# Design

## Context

See proposal.md for motivation. Source filtering is embedded in the search command. ZIP downloads already stream into a unique temporary path before renaming to the cache.

## Goals / Non-Goals

Preserve existing callers, progress events, limits, and installation behavior. Do not consolidate extraction paths or move unrelated command logic.

## Decisions

- Extract only source validation so its production path can be tested. Keep domain-owner rejection and reuse GitHub segment validation for repository names instead of banning dots in both segments.
- Use the existing tempfile dependency for download file ownership. Close the file handle before persisting its TempPath, preserving Windows semantics and atomic replacement. Manual cleanup on each error branch is more fragile and misses cancellation.
- Keep the public download entry point fixed to GitHub; a private URL-taking implementation allows local-server failure tests without changing application configuration or global client state.

## Risks / Trade-offs

- Temporary cleanup is best effort under OS permission errors; it is not a guarantee across process crashes.
- Persistence must retain replacement behavior for concurrent completed downloads. Verify replacement, isolated in-flight files, partial-body failure, and failed publication.
- Existing stale temporary files are left for the existing explicit cache-clear action.
