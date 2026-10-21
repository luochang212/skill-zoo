# Proposal

## Why

The 5,128-line landing page mixes styling, interaction code and duplicated translation fallbacks. Recent copy updates exposed drift between those copies. Adopt the independently built Astro structure already used by ADR Kit while preserving Skill Zoo's presentation and download flow.

## What Changes

- Extract the landing page into an independent static Astro site with section components, centralized bilingual copy and ordinary browser scripts.
- Generate English and Chinese routes, metadata and sitemap; resolve old language query links and base-prefixed assets correctly.
- Move website assets and the released-version manifest to site/public and prepare GitHub Actions Pages deployment with PR build/browser checks.
- Keep the current screenshots, visual style, carousel, navigation, install modal, platform asset selection and unknown-version fallback. Keep previously removed promotional controls absent.

## Capabilities

### New Capabilities

- `project-website`: Static bilingual project presentation, release downloads and deployment contract.

### Modified Capabilities

None. Desktop/CLI behavior and their local protocol are unchanged.

## Impact

Website source moves from docs/index.html into site/. Adds Astro, sitemap and browser-test tooling isolated from the desktop dependency tree. Release automation updates site/public/version.json. Publishing the prepared artifact requires the repository's Pages source to change from branch/docs to GitHub Actions; no live setting or deployment is changed during local implementation.
