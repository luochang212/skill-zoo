# Verification

## Post-implementation checks

- Frontend gates all pass: typecheck, oxlint (0 warnings / 0 errors), oxfmt check, and the full vitest suite — 54 files / 497 tests, including:
  - `SkillPreviewPanel.test.tsx`: repo label replaces the skill name in the footer and clicking it fires `onOpenRepo` once; `showProgressBar={false}` suppresses the bar both while loading and after (latch never activates).
  - `BrowseSkills.test.tsx`: wiring test with an App-shaped stateful harness — community card stub opens the panel, the footer shows `owner/repo` (not the skill name), clicking it calls `skillsApi.searchRepo("owner/repo")` and swaps the discover view for the repo-detail page (`repo-detail-stub` renders), and the preview is unmounted rather than carried over.
- OpenSpec: `npx openspec validate --all --strict` — 21 passed, 0 failed, including the `desktop-ui` delta.
- No backend/CLI changes; Rust suite not re-run.

## Verification boundary

- The two entry-path behaviors are covered end-to-end at component level, including the exact App.tsx wiring (stateful harness). No manual click-through of the desktop app was performed in this session; the dev app hot-reloads these frontend changes, so a visual pass of both paths (community card footer shows `owner/repo` and jumps; repo detail shows skill name with no progress flash) can be confirmed in the running dev instance.
- framer-motion exit animation is not exercised in tests: the harness asserts the real unmount semantics (view swap), which is what the production flow relies on.
