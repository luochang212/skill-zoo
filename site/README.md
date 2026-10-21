# Skill Zoo website

Independent static Astro website, following ADR Kit's site structure. The desktop
app and CLI do not import or build it. Public URL: https://www.luochang.ink/skill-zoo/.

## Develop and verify

Node.js **22.22+** and npm are required (CI uses Node 24). Astro's checker currently
supports TypeScript 6, so this isolated package uses the latest supported stable
6.x rather than the desktop's TypeScript 7.

```sh
npm --prefix site ci
npm --prefix site run dev
npm --prefix site run check
npm --prefix site run build
npm --prefix site exec -- playwright install chromium
npm --prefix site test
# Optional cross-engine verification
npm --prefix site exec -- playwright install webkit
npm --prefix site test -- --browser=webkit
npm --prefix site run preview
```

Dev and preview serve the site under `/skill-zoo/`, not `/`. Tests start the
production preview automatically on port 4322; build first. For an existing local
Chrome, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable when testing.
CI installs Playwright Chromium and does not require system Chrome. Optional
WebKit checks verify the same routes, UI and outbound download attempts. WebKit
does not emit a download event for the mocked cross-origin attachment in these
tests; this also occurs with the pre-migration page. Chromium additionally
checks the attachment download event. No test downloads a real release package.

## Source ownership

- `src/components/`: original page sections, carousel container and install modal.
- `src/layouts/Base.astro`: document, language resolution and SEO metadata.
- `src/i18n/ui.ts`: English/Chinese copy shared by build-time templates. Only
  installation strings are sent as JSON to the browser for the dynamic modal.
- `src/scripts/`: original native browser interactions split into carousel,
  downloads and page navigation/effects. Global CSS keeps the existing appearance.
- `public/`: screenshots, agent icons, favicon and released `version.json`.
- `dist/` and `.astro/`: generated and ignored; never edit or commit them.

English lives at `/skill-zoo/`, Chinese at `/skill-zoo/zh/`. Both pages render
localized HTML without JavaScript. With JavaScript, the root retains the previous
query/saved-language/browser-language preference. Automatic detection uses only
`navigator.languages` / `navigator.language`; timezone does not affect it.
Explicit `/zh/` stays Chinese;
`?lang=zh/en` overrides the route and retains query parameters and anchors. All
public assets and version requests use the deployment base, including on `/zh/`.

## Release and deployment

`.github/workflows/build.yml` writes the published tag into
`site/public/version.json` on main, using the existing `PAGES_TOKEN` checkout.
That main-branch push triggers `.github/workflows/site.yml`. Keep that credential
capable of triggering workflows: a commit made only with `GITHUB_TOKEN` does not
trigger another push workflow. The website never derives a published version
from `package.json`; if its manifest is unavailable, downloads fall back to the
GitHub releases list instead of inventing asset URLs.

The site workflow installs/checks/builds/tests affected pull requests without
deploying. A main-branch site push or manual main run uploads `site/dist` and
deploys it using the `github-pages` environment.

**One-time migration when publishing:** the repository currently uses
`main:/docs` as its legacy Pages source. After reviewing this change, switch
Settings → Pages → Build and deployment → Source to **GitHub Actions**, then
push/run the Site workflow on main. Preserve the existing domain and
`/skill-zoo/` URL. This code change does not change live repository settings.
The custom domain belongs to the user site; this project site does not add a
project-level CNAME.

Rollback: revert the migration and restore `main:/docs` as the Pages source.
Do not switch back to the branch source while the migrated tree lacks the old
`docs/index.html`.
