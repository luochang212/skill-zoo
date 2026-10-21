# Design

## Context

See proposal.md. The public URL is https://www.luochang.ink/skill-zoo/. Current Pages source is main:/docs (verified via GitHub API). Before migration, release automation checked out main with PAGES_TOKEN and pushed docs/version.json. It now writes site/public/version.json, and the site workflow watches that path and uses a fresh checkout. The app and CLI builds are independent of the website.

## Goals / Non-Goals

Preserve section order, CSS and interactive behavior while making copy a build-time source of truth. Generate static output suitable for Pages. No product redesign, new UI framework, backend, app protocol or screenshot replacement.

## Decisions

- Use independent site/package.json and npm lockfile, matching ADR Kit. Astro and sitemap are the only production dependencies. Keep native CSS/JS; section components render localized strings at build time. A React site would add runtime machinery without benefiting this content page.
- Serve English at /skill-zoo/ and Chinese at /skill-zoo/zh/. Legacy lang query parameters redirect before paint, retaining unrelated query parameters and anchors. Root language preference follows the old query/storage/browser priority; explicit /zh/ remains authoritative unless a query overrides it. Both pages have complete localized HTML without JavaScript.
- Use the original global CSS and markup rather than introducing scoped-selector changes. Separate carousel, downloads and page interaction scripts. Only install-modal strings are serialized for browser use; no runtime full-page translation pass.
- Keep released version in site/public/version.json, never infer it from a development package version. All nested-route assets and version requests use the /skill-zoo/ base. Unknown/unavailable versions keep the releases-list fallback.
- A site workflow builds and tests PRs, deploying only main pushes/manual runs. It watches site sources, its workflow and build.yml. The existing release task's PAGES_TOKEN commit updates the watched public manifest. Generated output is not committed.

## Risks / Trade-offs

- Added package installation and build maintenance: isolate site dependencies and lock them; keep the desktop build unchanged.
- Nested-route regressions: browser tests exercise both languages, legacy queries, all image URLs and platform downloads under the real base.
- Visual drift from template conversion: preserve CSS/markup and compare browser captures to the saved pre-migration page.
- Live Pages still uses branch deployment: document the source switch and do not publish uncommitted changes or silently change repository settings.

## Migration Plan

Build and validate locally, prepare Pages workflow, then commit/review. Before publishing, switch Pages source to GitHub Actions and push/run the site workflow. Rollback by reverting the migration and restoring main:/docs as the Pages source. Keep documentation images unrelated to the landing page in docs/.
