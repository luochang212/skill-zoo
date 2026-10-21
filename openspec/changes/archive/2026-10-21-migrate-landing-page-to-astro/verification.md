# Verification

## Implemented surface

The website is independently built from `site/`; the old `docs/index.html` and its
public assets have moved to Astro components/public resources. The app/CLI
sources and root dependency manifests have no changes. ADR 2 records the build
boundary. The main `project-website` spec includes all three delta requirements.

## Executed checks

- A clean `npm ci --prefix site --registry=https://registry.npmjs.org` succeeds
  from the committed lockfile. During validation, a missing optional Rolldown
  platform entry was caught and repaired by regenerating the lock metadata with
  the official registry before repeating the clean install.
- `npm run check --prefix site`: 25 files, zero errors/warnings/hints.
- `npm run build --prefix site`: static English/Chinese pages and bilingual sitemap.
- Playwright Chromium: 16 checks pass. Tests use intercepted, tiny attachment
  responses instead of downloading release packages; Chromium also checks the
  download event.
- Playwright WebKit: 16 checks pass, including both static languages, assets,
  language preferences/query links and all platform/version boundaries. WebKit
  does not emit an attachment event for the mocked cross-origin response, both
  before and after migration; these cases assert the outbound request, localized
  modal and package links instead. No production workaround was added.
- Production browser comparisons against the saved `fc5581f` HTML show matching
  section positions/heights and all existing translated copy for en/zh at
  1440px and 390px. Overview, feature and closing-section captures were generated
  and visually inspected. Three untranslated modal labels found during the
  initial comparison were connected to the shared dictionary and rechecked.
  Final visual QA also restored explicit spaces around the footer link after
  Astro whitespace compaction; two focused static-page checks cover the footer
  text and pass after the final rebuild. A parallel local rerun hit scheduling
  timeouts; rerunning those two cases with one worker passed in 10 seconds.
- `go run github.com/rhysd/actionlint/cmd/actionlint@latest .github/workflows/site.yml`
  passes. Parsed workflow assertions also confirm PR deployment exclusion and
  the manifest writer/path-filter alignment.
- Existing frontend lint, format check, typecheck, 234 tests and production build
  pass. The app build retains its existing theme-script/chunk-size warnings;
  app source was not changed. Rust tests were not rerun because no backend or
  local protocol code changed.
- Strict OpenSpec validation, ADR validation and `git diff --check` pass.

## Publication boundary

GitHub API inspection confirms the live Pages source is still `main:/docs`.
The Actions workflow and one-time source switch procedure are prepared in
`site/README.md`; repository settings and live deployment were not changed.
The preview is local. Cross-engine tests use current Chromium/WebKit, not an
installed Safari 16.4; the website build explicitly targets Safari 16.4 and
retains the original browser APIs/styles.
