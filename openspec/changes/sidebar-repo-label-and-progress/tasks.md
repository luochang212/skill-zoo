# Tasks

## 1. Shared panel

- [ ] 1.1 Add `repoLabel`/`onOpenRepo`/`showProgressBar` props; footer renders the clickable repo label only when both are provided; progress bar block and its latch are gated by `showProgressBar`.

## 2. Callers

- [ ] 2.1 RepoDetail passes `showProgressBar={false}`; skill-name footer unchanged.
- [ ] 2.2 BrowseSkills passes `repoLabel={previewTarget.source}` and closes the preview before jumping via `handleSkillSearchResult`.

## 3. Tests and gates

- [ ] 3.1 Panel tests: repo label replaces the skill name and triggers `onOpenRepo`; `showProgressBar={false}` suppresses the bar including the completion state.
- [ ] 3.2 BrowseSkills wiring test with an App-shaped harness: card → footer repo label → repo detail replaces discover view, preview unmounted.
- [ ] 3.3 Verify typecheck, lint, formatting, full frontend suite and strict OpenSpec validation.
