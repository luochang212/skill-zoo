# Design

## Context

React Query already owns discovery results, but page-local event listeners and selections disappear on unmount. Queries do not consume an abort signal. Existing mutations invalidate repository skill results; those status updates must continue working.

## Goals / Non-Goals

Support session-only background work and direct continuation. Keep installation explicit and preserve unsaved editor/create drafts. Do not add a durable task queue, automatic installation, cross-restart recovery, or a second server-state cache.

## Decisions

- A session provider maintains UI task membership, selections, and progress; React Query remains the only result/error cache. Successful hidden queries stay observed but disabled, so installation invalidation marks them stale for their next visit instead of reloading every repository in the background.
- Queries use owner/repository/explicit-branch identity, including a distinct default-branch identity. Register global progress listeners before starting requests and add branch identity to Rust events. Completion comes from the whole command result, not the early end of ZIP scanning.
- Reuse in-flight IPC promises per identity so invalidation or retries cannot start duplicate Rust operations. Explicit refresh uses the same query and force-download path.
- Keep background terminal entries until viewed or dismissed. Toast actions use current navigation guards, never auto-navigate, and never imply installation. Reuse the house dropdown. Preserve the repository refresh/loading control and original stage text; add no progress lines or numeric percentages.
- Define the React context separately from its provider implementation so hot updates do not replace the context identity while consumers are mounted.
- Keep metadata and README reads independent of skill-list loading. README links retain the existing external repository navigation behavior.

## Risks / Trade-offs

- Session selections and loaded query results use memory until the app closes; they are not written to disk.
- Progress events must agree on branch identity. Test same repository/different branches, listener cleanup, and navigation/remount behavior.
- Filesystem invalidation must refresh install status without retrying failed tasks automatically or duplicating active work.
