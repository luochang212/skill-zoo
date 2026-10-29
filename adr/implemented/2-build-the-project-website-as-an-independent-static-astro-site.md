---
status: implemented
date: 2026-10-21
raised-by: human
decided-by: human
created: 2026-10-21
description: Read before changing the site/ landing page, its build or deploy workflows, or moving site ownership into the desktop build.
paths:
  - site/**
  - .github/workflows/site.yml
  - .github/workflows/build.yml
---

# ADR: 2 Build the project website as an independent static Astro site

## Problem

The project landing page combined styling, interactions and duplicate translation fallbacks in one document. Copy updates exposed disagreement between static markup and the browser dictionary. The desktop app's React/Tauri build does not own this public content site.

## Decision

Own the public website in an independently built `site/` Astro package, following ADR Kit's static-site structure. Generate localized section components from one bilingual dictionary, preserve the current visual presentation and native browser interactions, and publish the static output through GitHub Pages Actions. Keep released-version data in the public manifest owned jointly by release automation and the site build, never the development package version. Website dependencies must not enter the desktop/CLI runtime dependency graph.

The package/configuration files own dependency versions and routing details; `site/README.md` owns commands and the deployment source switch procedure.

## Alternatives considered

- Keep the standalone HTML: lowest build cost, but continues duplicate content ownership and leaves shared layout/metadata changes mixed with interaction code.
- Split files without a static generator: isolates styles/scripts but does not provide build-time component composition or localized output by itself; a custom renderer would recreate the necessary part of Astro.
- Reuse the desktop React application: adds runtime UI machinery to a content site and couples unrelated builds and deployment lifecycles.

## Consequences

### Verification

- English and Chinese production HTML contain localized copy and screenshots without requiring runtime translation.
- Real-browser checks cover base-prefixed assets, old language links, carousel/navigation and platform/version download boundaries.
- The site workflow defines PR validation without deployment and watches main-branch release-manifest changes. Local actionlint and workflow path checks pass; live Actions deployment has not been run.
- Visual comparison preserves the established section layout and product copy; desktop/CLI commands remain independent.

### Trade-offs

An additional package and build need upkeep. Dependencies and their lockfile are isolated in `site/`. Migration can break nested-route resources or make release metadata stale; regression tests and path-filter checks cover those boundaries. Actual publication requires the documented repository Pages source switch; local implementation must not silently change live settings.
