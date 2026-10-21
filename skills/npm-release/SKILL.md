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
dist/index.js
package.json
wui/app.js
wui/index.html
wui/styles.css
```

There is deliberately no `dist/index.d.ts`. The CLI entry (`packages/cli/src/index.ts`)
is a shebang script that calls `runCli()` and exports nothing, so the declaration file
tsup's `--dts` emitted contained only the shebang line — a type contract with no types.
It was also unreachable: the package declares `bin` and no `main`/`exports`/`types`, so a
consumer's `import ... from "skill-zoo"` fails with `TS2307` before the file is ever read
(wiring up `types` instead yields `TS2306: is not a module`). Rather than keep a
misleading empty file, the build no longer emits declarations. If the CLI ever grows a
programmatic API, re-add declarations *and* the `types`/`exports` wiring together.

If extra source, test, repo, log, or private files appear, fix the `files` whitelist or ignore rules before publishing.

**Mirror CI's steps, not just the package's.** The bump touches `packages/cli/package.json` and `bun.lock`, and `build.yml` checks those from the workspace root with steps the package-level list above never runs. Run them locally after the bump too:

```bash
cd ../..
bun run lint && bun run format:check && bun run typecheck && bun run test
bun run cli:typecheck
```

When the workflow changes, re-derive the list from it rather than trusting this skill: `grep -nE '^\s+-?\s*run:' .github/workflows/build.yml`. A step CI runs that the local list omits is a blind spot — on 2026-10-22 adr-kit's 0.24.0 passed every local check and went red on the one CI step that was not in its skill.

**Fifth gate: green CI on the pushed release commit.** The local checks run on one machine; CI runs on every platform the release must work on. Commit the release, push, and wait for the runs before publishing. Watch by workflow name and the pushed commit's SHA — `gh run list --limit 1` returns whichever run started last, which can be `site` (it also runs on a push that touches `site/`) or a run for another commit, and then reports green while `build` fails:

```bash
git push origin main
sha="$(git rev-parse HEAD)"
for wf in build site; do
  id="$(gh run list --workflow "$wf" --limit 5 --json databaseId,headSha \
    --jq ".[] | select(.headSha==\"$sha\") | .databaseId" | head -1)"
  [ -n "$id" ] && gh run watch "$id" --exit-status
done
```

Code CI has not seen does not publish. On 2026-10-13 the release-adjacent `chore: update version.json for v0.3.52` commit landed on main with a failing Build. If the release commit's run fails, fix forward in a new commit, push, and wait again; never amend or force-push a pushed release commit.

## CLI Package Checks

Before publishing a CLI package, verify the executable path matches `bin` and can start from the built artifact:

```bash
cd ../..
sed -n '1,20p' packages/cli/src/index.ts
sed -n '1,20p' packages/cli/dist/index.js
ls -l packages/cli/dist/index.js
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

Publish only after typecheck, tests, build, `npm publish --dry-run` pass, and the pushed release commit's CI run is green. Before the real `npm publish`, summarize the package name, version, dist tag, and tarball contents, then ask the user for explicit confirmation.

**Log in first.** `--auth-type=web` authenticates `npm login`, not `npm publish` — publishing while unauthenticated fails with a 404 that masks the real cause. Ensure a valid token exists (see "Non-TTY browser authentication") before publishing, and drop `--auth-type=web` from the publish command.

**Working directory does not persist between tool calls.** Always include `cd <path>` in the command itself — never assume a previous `cd` still applies. When publishing from a workspace sub-package, use an absolute `cd` prefix:

```bash
cd /path/to/repo/packages/cli && npm publish --registry https://registry.npmjs.org/
```

Preferred command after user confirmation:

```bash
cd packages/cli
npm publish --registry https://registry.npmjs.org/
```

If the machine's default registry is a read-only mirror (e.g. `registry.npmmirror.com`), the explicit `--registry https://registry.npmjs.org/` is required — mirrors do not accept publishes.

### Non-TTY browser authentication

Two different steps need browser auth, and npm handles them differently in agent environments (Claude Code, Cowork, CI):

**Capture auth URLs from raw output only.** Run both commands so their full output lands in a file (a background task's output file), then grep that file for the URL. Never pipe `npm login` or `npm publish` themselves through `grep`, `sed`, `tail`, or any other filter: npm goes quiet while it polls for the browser authorization, and a filter's block buffer then holds the URL line indefinitely — the attempt has to be killed and rerun raw.

**Login** — `npm login --auth-type=web` prints the full `https://www.npmjs.com/login?next=/login/cli/<id>` URL even without a TTY, so no `script` wrapper is needed. Just `open` the printed "Login at:" URL:

```bash
npm login --auth-type=web --registry https://registry.npmjs.org/
# then open the printed "Login at:" URL in the user's browser
```

**Publish 2FA (EOTP)** — when the account requires 2FA for publishing, `npm publish` fails with `EOTP` and prints its auth URL redacted as `***` (`https://www.npmjs.com/auth/cli/***`). Only this step needs a real TTY to reveal the URL. Use `script -q /dev/null`, and feed it a leading newline because npm's TTY prompt ("Press ENTER to open in the browser...") otherwise blocks before it polls for authentication:

```bash
printf '\n' | script -q /dev/null npm publish --registry https://registry.npmjs.org/ 2>&1   # background task, RAW output
# grep the background output FILE for the real "https://www.npmjs.com/auth/cli/<id>"
# URL, then — never pipe the publish command itself through a filter:
open "https://www.npmjs.com/auth/cli/<id>"
```

Extract the URL, open it in the user's browser, and keep the background process alive while they authenticate. If `script` is unavailable (e.g. a sandbox blocks pty allocation), fall back to `--otp <6-digit TOTP>`.

Success looks like:

```text
+ skill-zoo@X.Y.Z
```

## Post-Publish Verification

Registry reads can lag after publish — about a minute is typical, and adr-kit saw 130 seconds on 2026-10-22 after a `PUT 202` with the notice "Your package is being processed and may take a few minutes to become available". Poll the exact version every 10 seconds for up to three minutes before concluding the publish failed, then verify both the specific version and the dist tag:

```bash
for i in $(seq 1 18); do
  npm view skill-zoo@X.Y.Z version 2>/dev/null | grep -q 'X.Y.Z' && break
  sleep 10
done
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
| `npm publish` returns 404 / "do not have permission" | Not logged in — `--auth-type=web` does not authenticate at publish time | Run `npm login --auth-type=web --registry https://registry.npmjs.org/` first, then publish |
| `npm error code EOTP` | Account requires 2FA for publishing | Either get the user's 6-digit TOTP and pass `--otp <code>`, or complete the browser web-OTP flow (see "Non-TTY browser authentication") |
| Browser auth URL is `***` | npm redacted the publish OTP URL in non-TTY output | Wrap the publish in `script -q /dev/null` with a leading newline (see "Non-TTY browser authentication"), extract the real URL, then `open` it |
| Auth URL never surfaces while "Authenticate your account at:" did | Publish output was piped through `grep` or another filter; npm's quiet auth polling left the URL in the filter's block buffer | Kill the attempt — nothing publishes without the browser flow — rerun with raw output, and grep the output file |
| A platform test failure appears in CI after pushing the release commit | Code reached the release without ever passing CI | Fix, commit, push, wait for green; publish only commits whose CI run is green |
| Every local check passed but CI failed on a step such as `lint`, `format:check`, or root `typecheck` | The skill's package-level checks do not cover `build.yml`'s workspace-root steps, which also see the bumped `package.json` and `bun.lock` | Run the root `bun run lint && bun run format:check && bun run typecheck && bun run test` after the bump; re-derive the step list from the workflow when it changes |
| `gh run watch` reported green but `build` failed | `gh run list --limit 1` picked the `site` workflow or a run for another commit | Watch runs by workflow name and the pushed commit's SHA, as in Required Verification |
| npm errors with `EPERM` on the `~/.npm` cache | Cache dir has root-owned files from an old npm bug | Run `sudo chown -R $(id -u):$(id -g) ~/.npm`, or use a temp cache via `--cache /tmp/xxx` |
| `npm login` fails writing `~/.npmrc` (EPERM) | Home dir not writable from the agent sandbox | Log in with `--userconfig /tmp/xxx.npmrc` and pass the same `--userconfig` to `npm publish`; delete the file afterward |
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

# log in first (prints the full URL even non-TTY); skip if a valid token already exists
npm login --auth-type=web --registry https://registry.npmjs.org/
# open the printed "Login at:" URL, wait for the user to authenticate

cd /path/to/repo/packages/cli
npm run typecheck
npm test
npm run build
npm publish --dry-run

# mirror build.yml's workspace-root steps; the bump touched package.json and bun.lock
cd /path/to/repo
bun run lint && bun run format:check && bun run typecheck && bun run test
bun run cli:typecheck

# commit the release bump, push, and wait for CI — green runs are a publish precondition
git push origin main
sha="$(git rev-parse HEAD)"
for wf in build site; do
  id="$(gh run list --workflow "$wf" --limit 5 --json databaseId,headSha \
    --jq ".[] | select(.headSha==\"$sha\") | .databaseId" | head -1)"
  [ -n "$id" ] && gh run watch "$id" --exit-status
done

# summarize dry-run results and ask the user to confirm the real publish
# if the account requires 2FA, the publish OTP URL is redacted as *** — wrap with script:
printf '\n' | script -q /dev/null npm publish --registry https://registry.npmjs.org/ 2>&1   # background task, RAW output
# grep the output file for the "Authenticate your account at:" URL, open in browser, wait for user

npm view skill-zoo@X.Y.Z version dist.tarball time --json
npm dist-tag ls skill-zoo
npm view skill-zoo versions --json
```

Keep the package release commit separate from unrelated feature work when possible. If the user's working tree already contains feature changes intended for the release, report them clearly instead of hiding them inside the release summary.
