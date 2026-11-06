# Design

## Context

Repository details currently render five placeholder rows; recommended repositories render six cards; local lists render ten rows. Those counts leave visible gaps at the configured 1100 × 700 window size. The shared Skeleton primitive also serves genuinely small UI regions.

## Goals / Non-Goals

Cover the available page content while preserving actual row/card sizes. Do not turn every local placeholder into a full-screen block, alter loaded layouts, or add viewport measurement state.

## Decisions

Use sufficient fixed placeholder counts for the default window and constrain their parent flex regions with min-height zero and overflow clipping. Initial-loading regions do not need a scroll container; real content keeps its current ScrollArea. Keep the local repository README loading panel bounded to its own area. Remove only the discovery detail README and query; preserve local README readers.

## Risks / Trade-offs

Counts target the default window, not unlimited maximized displays. Verify list/grid bounds in Chromium and WebKit at 1100 × 700. Preserve existing compact navigation and modal shapes rather than inventing unknown rows or sections.
