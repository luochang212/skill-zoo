---
name: npm-release
description: Use when publishing or preparing to publish an npm package from this repository, especially the Skill Zoo CLI package under packages/cli. Also use when npm publish fails because of duplicate versions, npm authentication, browser authentication, dist-tag propagation, tarball contents, bin entry issues, or workspace/lockfile version mismatches.
---

# npm Release

## Overview

Publish an npm package from this repo with local verification, clean package contents, and npm browser authentication. For Skill Zoo today, the npm package is the CLI package in `packages/cli`; the workspace root is private and is not the package to publish.

**Announce at start:** "I'm using the npm-release skill to publish the npm package."

## Privacy Guardrails

Do not write private npm account details into repo files, skill files, logs, release notes, or final summaries. This includes npm usernames, email addresses, authentication secrets, browser auth URLs, auth IDs, tokens, local npm debug log paths, and machine-specific temporary directories.

It is fine to state generic facts such as "npm required browser authentication" or "the authenticated owner account was permitted." Do not paste the actual authentication URL into a committed file. If a URL is needed transiently, use it only to complete the live browser flow.

## When to Use

Use this skill when:

- The user says "publish npm", "release the npm package", "npm publish", "发 npm", or "发布 npm 包"
- The package is in a workspace and you need to identify the real publishable package
- `npm publish` fails with duplicate version, npm authentication, owner, tarball, or bin problems
- The user asks whether a package is ready for npm publication
- A release bump needs to update package metadata and lockfile state consistently

Do not use this skill for:

- Desktop app GitHub Releases or Homebrew cask releases; use `app-release`
- Tauri updater implementation; use `tauri-updater`
- Publishing a package you have not locally verified

## Package Target

For this repo, start with the CLI package:

```bash
cd packages/cli
```

Confirm the root package is not the target:

```bash
node -e "console.log(require('./package.json').private)"
node -e "const p=require('./packages/cli/package.json'); console.log(p.name, p.version, p.bin)"
```

If the target changes in the future, publish from the directory whose `package.json` has the public npm `name`, `bin`, `files`, `scripts.prepack`, and production `dependencies`.

## Preflight

Check the repo instructions and current working tree first:

```bash
test -f CLAUDE.md && sed -n '1,220p' CLAUDE.md
test -f AGENTS.md && sed -n '1,220p' AGENTS.md
git status --short
```

Do not revert or overwrite unrelated changes. If publish-relevant files already have user edits, inspect them and work with the current state.

Check npm registry state before changing versions:

```bash
cd packages/cli
npm view skill-zoo version dist-tags --json
npm view skill-zoo versions --json
npm whoami
npm owner ls skill-zoo
```

If the local version already exists on npm, explain that npm versions are immutable and ask the user which new version to publish before changing files. Do not choose or apply the release version silently.

## Version Bump

For the Skill Zoo CLI package, update:

- `packages/cli/package.json`
- `bun.lock` workspace entry for `packages/cli`

Ask the user to confirm the exact version before editing release files. If they ask for a recommendation, propose the smallest sensible semver bump and explain why, then wait for confirmation before applying it.

After bumping, search for hardcoded old versions that should follow the package version:

```bash
OLD_VERSION=<previous-version>
rg "\"version\": \"${OLD_VERSION}\"|skill-zoo-cli@${OLD_VERSION}|skill-zoo@${OLD_VERSION}" packages/cli bun.lock
```

Tests should generally depend on `CLI_VERSION` rather than hardcoding a release version. This prevents a release bump from breaking tests only because an expected metadata string changed.

## Required Verification

Run these from `packages/cli` after any version or release-related change:

```bash
npm run typecheck
npm test
npm run build
npm publish --dry-run
```

The dry-run must show the expected version and tarball contents. For this CLI, expected package contents are small and should normally be:

```text
README.md
dist/index.d.ts
dist/index.js
package.json
wui/app.js
wui/index.html
wui/styles.css
```

If extra source, test, repo, log, or private files appear, fix the `files` whitelist or ignore rules before publishing.

## CLI Package Checks

Before publishing a CLI package, verify the executable path matches `bin` and can start from the built artifact:

```bash
cd ../..
sed -n '1,20p' packages/cli/src/index.ts
sed -n '1,20p' packages/cli/dist/index.js
ls -l packages/cli/dist/index.js packages/cli/dist/index.d.ts
node packages/cli/dist/index.js --version
node packages/cli/dist/index.js --help | sed -n '1,120p'
```

For higher confidence, install the actual tarball in a temporary project and run both binary names:

```bash
cd packages/cli
tmp="$(mktemp -d)"
npm pack --pack-destination "$tmp"
mkdir "$tmp/install"
cd "$tmp/install"
npm init -y >/dev/null
npm install "$tmp"/skill-zoo-*.tgz
./node_modules/.bin/skill-zoo --version
./node_modules/.bin/szoo --help | sed -n '1,40p'
```

Do not commit generated tarballs or temporary install directories.

## Publishing

Publish only after typecheck, tests, build, and `npm publish --dry-run` pass. Before the real `npm publish`, summarize the package name, version, dist tag, and tarball contents, then ask the user for explicit confirmation.

**Working directory does not persist between tool calls.** Always include `cd <path>` in the command itself — never assume a previous `cd` still applies. When publishing from a workspace sub-package, use an absolute `cd` prefix:

```bash
cd /path/to/repo/packages/cli && npm publish --auth-type=web
```

Preferred command after user confirmation:

```bash
cd packages/cli
npm publish --auth-type=web
```

### Non-TTY browser authentication

In agent environments (Claude Code, Cowork, CI), npm detects non-interactive terminals and redacts browser auth URLs as `***`. This blocks you from opening the link for the user. To get the real URL, wrap the command with `script -q /dev/null` to simulate a TTY:

```bash
script -q /dev/null npm publish --auth-type=web 2>&1 &
sleep 8
# grep the real URL from output, then:
open "https://www.npmjs.com/auth/cli/<id>"
```

The `script` wrapper causes npm to print the full `https://www.npmjs.com/auth/cli/<id>` URL instead of `***`. Extract it, open it in the user's browser, and keep the background process alive while they authenticate.

The same `script -q /dev/null` trick works for `npm login --auth-type=web` if the initial login also needs browser auth.

Success looks like:

```text
+ skill-zoo@X.Y.Z
```

## Post-Publish Verification

Registry reads can briefly lag after publish. Verify both the specific version and the dist tag:

```bash
npm view skill-zoo@X.Y.Z version dist.tarball time --json
npm dist-tag ls skill-zoo
npm view skill-zoo versions --json
```

Treat `npm dist-tag ls` as the clearer signal for `latest` when `npm view skill-zoo version` appears stale immediately after publication.

The final user summary should include:

- Published package and version
- Verification commands that passed
- Registry confirmation, including `latest` if applicable
- Local files changed and still uncommitted

Do not include private account identifiers, browser auth URLs, npm auth IDs, authentication secrets, debug log paths, or temporary directory paths in the final summary.

## Failure Handling

| Failure | Cause | Response |
|---|---|---|
| `You cannot publish over the previously published versions` | Local version already exists on npm | Ask the user to confirm the new version, then bump `packages/cli/package.json`, sync lockfile, and rerun checks |
| npm asks for additional authentication | npm account requires an interactive verification step | Retry with `npm publish --auth-type=web` in a TTY and use browser auth |
| Browser auth URL is `***` | npm redacted URL in non-TTY output | Wrap with `script -q /dev/null npm publish --auth-type=web 2>&1 &`, extract the real URL from output, then `open` it |
| Tests fail after version bump | Hardcoded expected version | Prefer asserting against `CLI_VERSION` |
| Dry-run includes unexpected files | Bad `files` whitelist or generated artifacts | Fix package manifest before publishing |
| Bin command fails after tarball install | `bin` path, shebang, executable bit, or bundle issue | Fix before publishing and rerun tarball install check |
| `latest` appears stale after success | Registry/cache delay | Query `npm dist-tag ls` and the exact `name@version` |

## Command Sequence

Use this as the default release skeleton for `skill-zoo` CLI:

```bash
cd /path/to/repo
git status --short
npm view skill-zoo version dist-tags --json

# ask the user to confirm the exact version, then bump packages/cli/package.json and bun.lock if needed

cd /path/to/repo/packages/cli
npm run typecheck
npm test
npm run build
npm publish --dry-run

# summarize dry-run results and ask the user to confirm the real publish
# in non-TTY (agent) environments, use script wrapper to get real auth URL:
script -q /dev/null npm publish --auth-type=web 2>&1 &
# extract URL, open in browser, wait for user to authenticate

npm view skill-zoo@X.Y.Z version dist.tarball time --json
npm dist-tag ls skill-zoo
npm view skill-zoo versions --json
```

Keep the package release commit separate from unrelated feature work when possible. If the user's working tree already contains feature changes intended for the release, report them clearly instead of hiding them inside the release summary.
