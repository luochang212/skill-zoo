---
name: npm-release
description: Use when publishing or preparing to publish an npm package from any repository, when asked whether a package is ready to publish, or when npm publish fails because of duplicate versions, authentication, dist-tag propagation, tarball contents, bin entry issues, or workspace/lockfile version mismatches. Project-independent: the repository's own docs and CI override this skill.
---

# npm Release

## Overview

A project-independent release workflow for npm packages. Read the repository's
package.json, README, AGENTS.md/CLAUDE.md, CI workflows, and release docs first;
they override this skill. Discover the package name, version source, checks, and
registry at runtime. Never hardcode one project's path, package name, version,
or commands here.

**Announce at start:** "I'm using the npm-release skill to publish the npm package."

## When to Use

Use this skill when:

- The user says "publish npm", "release the npm package", "npm publish", "发 npm", or "发布 npm 包"
- The user asks whether a package is ready for npm publication
- The package lives in a workspace and the real publishable package must be identified
- A release bump must update package metadata, lockfile, and changelog consistently
- `npm publish` fails with duplicate version, authentication, tarball, bin, or dist-tag problems

Do not use this skill for:

- Desktop app or other non-npm release flows (in repositories that have an `app-release` skill, use that)
- Publishing a package that has not passed the local checks and tarball smoke test below

## Privacy Guardrails

Do not write private npm account details into repo files, skill files, logs,
release notes, or final summaries: npm usernames, email addresses, tokens,
browser auth URLs, auth IDs, and local npm debug log paths. Generic statements
such as "npm required browser authentication" are fine. Use a live auth URL only
to complete the browser flow; never paste it into a committed file.

## Release Audit

Start here on every invocation and inspect live state; never assume a previous
attempt completed. Run from the package directory, or from the workspace root
after identifying the package that will actually be published.

```bash
git status --short

node -e 'const p=require("./package.json");console.log({name:p.name,version:p.version,private:p.private,workspaces:p.workspaces,files:p.files,bin:p.bin,main:p.main,exports:p.exports,types:p.types,scripts:p.scripts,publishConfig:p.publishConfig,packageManager:p.packageManager})'

PKG=$(node -p "require('./package.json').name")
VER=$(node -p "require('./package.json').version")

npm config get registry
npm whoami
npm owner ls "$PKG" 2>/dev/null   # permission context; 404 when unpublished
npm view "$PKG" version dist-tags --json
git tag -l --sort=-v:refname | head -5
```

Target selection:

- If the user named a package, use it. If the root package is `private` but
  declares workspaces, the root is not the publish target: identify the
  workspace member whose package.json has the public npm `name`, `bin`, `files`,
  and production `dependencies`, and run every check in that directory.

Registry:

- Installs may work through a mirror while publishes are rejected. Check both
  the configured registry and `publishConfig`; use the registry the project
  actually targets, explicitly. Do not silently repoint a private package at the
  public registry.
- A 404 from `npm view` means the name is not currently published there; it does
  not prove the name is available for a new owner.

Authentication:

- `npm whoami` proves the current session only. `npm login` and `npm publish`
  are separate auth moments.
- If the account requires 2FA, expect an interactive browser flow. Do not ask
  the user for a TOTP code unless they explicitly offer one.

Version:

- npm versions are immutable. If the local version already exists on the
  registry, explain that and ask which new version to publish; never choose
  silently.
- A published version with no matching git tag must be backfilled deliberately,
  not by tagging today's HEAD.

Working tree:

- Do not revert or overwrite unrelated working-tree changes. Inspect them and
  work with the current state; if the release would also carry feature work,
  say so in the summary instead of hiding it inside the release.

Present the audit (package, registry, published baseline, local version,
working-tree state) and the next action before mutating anything.

## Version and Changelog

Use the mechanism the repository already uses. Do not introduce a new release
tool during a release.

- changesets: if `.changeset/` exists, run the project's version flow and let it
  update package.json and the changelog. A hand-authored changeset file must
  open with a `---` front-matter delimiter; when it starts directly with the
  `"package": minor` line, `changeset version` fails with `could not parse
  changeset - missing or invalid frontmatter`. Nothing in CI runs `changeset
  version`, so pushes never catch this — run the version flow once before the
  release, not only at it.
- release-please, semantic-release, lerna, or a custom script: follow the
  repository's documented command.
- manual: edit package.json, update the lockfile the repository commits (for
  npm's lockfile: `npm install --package-lock-only --ignore-scripts`), and
  update other version references the project keeps (docs, badges, constants).

All version carriers must agree. After a manual bump, search for stale hardcoded
versions the project tracks:

```bash
rg '"version": "<old-version>"' --glob '!node_modules'
```

Prefer tests that read the version from the manifest over tests that hardcode a
release version, so a bump cannot break them. Propose the smallest sensible
semver bump if the user asks for a recommendation, then wait for confirmation of
the exact version before editing release files.

### Changelog

Follow the project's existing changelog convention; do not invent a format.

- If a tool maintains the changelog (changesets, release-please), let it. Do not
  hand-edit against the tool.
- If the project keeps CHANGELOG.md by hand, add the new section at the top,
  matching the existing heading style:

  ```markdown
  ## [X.Y.Z] — YYYY-MM-DD
  ```

  Use today's date and group entries under **Added**, **Changed**, **Fixed**
  headings; omit empty groups. Review commits since the last tag so nothing is
  missed:

  ```bash
  git log --oneline <last-tag>..HEAD
  ```

  Write user-impact sentences, not commit subjects: say what users can now do or
  what now behaves correctly, and why it matters. Match the voice of previous
  sections.
- If the project keeps no changelog, do not create or backfill one
  mid-release; put the summary in the release notes instead.

If the repository's release workflow fills a release-body template by
substituting placeholders (for example `__VERSION__` or `__COMMITS__`), keep the
template valid and never hardcode values into it.

### Release Impact Check

After writing the changelog, decide whether this release touches the project's
contract surfaces: the docs, fixtures, schemas, or validations the project
itself treats as authoritative. Use the changed paths since the last tag as
review prompts, not automatic gates. Typical prompts:

- Documentation that describes behavior this release changes.
- Fixtures or schemas representing an interface the release alters.
- Files the release mechanism itself consumes or deletes. A tool that deletes
  its inputs (changesets consumes `.changeset/*.md`) can invalidate a doc,
  record, or test that scopes those paths — and the local checks that passed
  before the bump will not catch it afterwards. Check before the bump.
- User-visible compatibility, migration, or breaking behavior.

If there is impact, verify the affected surfaces still reflect reality before
continuing, and make sure the changelog mentions user-visible behavior. If
there is none, note it internally and continue — do not add "no impact" lines
to the changelog or commit messages.

### Release Commit

Version files, lockfile, and changelog go into a single release commit (for
example `chore: release vX.Y.Z`), separate from unrelated feature work. Never
amend or force-push a pushed release commit; fix forward.

## Required Checks

Run the project's own checks, not an invented checklist. Read package.json
scripts and the release CI workflow, then run the closest equivalents locally:

```bash
npm test
npm run build
npm pack --dry-run
```

Not every project has every script; if one is missing, say so rather than
pretending it ran. If the package has a build, verify the published entry points
come from the build output, not stale files.

**Mirror CI's steps, not just the package's.** A bump can touch files that only
the workflow's root-level steps check (lockfiles, root manifests, formatting).
Re-derive the step list from the workflow rather than trusting this skill:

```bash
grep -nE '^\s+-?\s*run:' .github/workflows/*.yml
```

A step CI runs that the local list omits is a blind spot.

**Green CI on the release commit.** Where the project gates releases on CI,
commit the release, push, and wait for the runs of that exact commit before
publishing. Watch by workflow name and the pushed SHA:

```bash
sha="$(git rev-parse HEAD)"
for wf in <gating workflows>; do
  id="$(gh run list --workflow "$wf" --limit 5 --json databaseId,headSha \
    --jq ".[] | select(.headSha==\"$sha\") | .databaseId" | head -1)"
  [ -n "$id" ] && gh run watch "$id" --exit-status
done
```

`gh run list --limit 1` alone can return an unrelated workflow's run (a docs or
site workflow also triggers on push) and report green while the real build
fails. If the release commit's run fails, fix forward in a new commit, push, and
wait again.

## Tarball Review

Inspect the tarball with the JSON output, not just the human summary:

```bash
npm pack --dry-run --json
```

The tarball must carry the entry points, bin files, type declarations, license,
README, and runtime assets the package needs. It must not carry `.env` files,
`.npmrc` with tokens, credentials, local agent state, editor caches, coverage,
test fixtures with secrets, or generated `.tgz` files.

Use `files` or `.npmignore` deliberately. A missing file in the tarball is a
packaging bug, not something to patch after publishing.

Check lifecycle scripts before publishing. `prepublishOnly`, `prepare`, and
`prepack` can run during pack or publish; read them and know what they do.
`npm publish --dry-run` also runs them, so use it only when you intend that.
`prepublishOnly` does not run for `npm pack`, so on a clean clone build before
packing or the dry-run reports missing or stale build output.

## Install Smoke Test

Do not publish a tarball you have not installed.

```bash
tmp=$(mktemp -d)
npm pack --pack-destination "$tmp"
mkdir "$tmp/install" && cd "$tmp/install"
npm init -y >/dev/null
npm install "$tmp"/*.tgz --ignore-scripts

# Then run the package's own smoke check:
# - the bin from node_modules/.bin, or
# - a minimal import/require of the documented entry point.
rm -rf "$tmp"
```

The reported bin version must match the tarball name. Do not commit generated
tarballs or temporary install directories.

A peer-dependency warning from a locally linked package is not automatically a
release failure; verify the actual entry point and bin instead.

For host-installed packages, plugins, or extensions, add one more gate: use the
host's documented installer in an isolated HOME or config directory, and verify
discovery and activation. Never install into a live user profile during a
release. If the host has a dry-run, config-dump, or list command, use it.

## Publishing

Publish only after the checks, tarball review, and smoke test pass — and, where
the project requires it, green CI on the release commit. Summarize before the
real publish:

- package name and version
- dist-tag (latest, next, beta)
- registry
- access (public or restricted)
- tarball contents and size

Then ask for explicit confirmation.

**Log in first.** `--auth-type=web` authenticates `npm login`, not `npm
publish`; publishing while unauthenticated fails with a 404 that masks the real
cause.

```bash
npm login --auth-type=web
```

If the configured registry is a read-only mirror, pass the publishable registry
explicitly to both login and publish (`--registry <url>`); mirrors reject
publishes. Read `publishConfig` first — explicit CLI flags override it. For a
scoped public package use `--access public`. For a prerelease, publish under a
non-latest tag such as `next` or `beta`; never publish a prerelease to latest by
accident.

Working directory does not persist between tool calls; include the `cd <path>`
in the command itself.

### Non-TTY Browser Authentication

Two different steps need browser auth, and npm handles them differently in
agent environments:

**Capture auth URLs from raw output only.** Run the command so its full output
lands in a file (a background task's output file), then grep that file for the
URL. Never pipe `npm login` or `npm publish` themselves through `grep`, `sed`,
`tail`, or any other filter: npm goes quiet while it polls for authorization,
and a filter's block buffer then holds the URL line indefinitely.

**Login.** `npm login --auth-type=web` prints the full login URL even without a
TTY. Open the printed "Login at:" URL in the user's browser.

**Publish 2FA (EOTP).** When the account requires 2FA for publishing, `npm
publish` fails with `EOTP` and prints its auth URL redacted as `***`. Run the
publish under `expect` so the "Press ENTER to open in the browser" prompt is
answered when it appears, keep the raw output in a file, grep the file for the
real `https://www.npmjs.com/auth/cli/<id>` URL, and open it. A pre-fed newline
(for example `printf '\n' | script -q /dev/null npm publish`) is not reliable:
it can arrive before the prompt and leave npm blocked. If the auth URL opens
but the browser lacks the npm session, finish the login or passkey step in the
already-logged-in browser. npm may escalate the authorization to WebAuthn
(redirecting to `/escalate/webauthn` and asking for a passkey confirmation);
that is expected, not an error — the CLI keeps polling while it completes. If
`expect` is unavailable, fall back to `--otp <6-digit TOTP>` with a code the
user supplies.

Keep the background process alive while the user authenticates.

Do not bypass a failing `prepublishOnly` or `prepare` script with
`--ignore-scripts`. That script is a release gate; fix the failure or get an
explicit decision.

`npm publish --provenance` is a CI/OIDC feature. It needs `id-token: write` and
a public source repository; a local publish cannot provide provenance. If
provenance is required, use or add a release workflow before publishing.

Success looks like:

```text
+ <package>@<version>
```

## Post-Publish Verification

Registry reads can lag after publish — about a minute is typical, but a `PUT
202` with the notice "Your package is being processed" can take longer. Poll the
exact version every 10 seconds for up to three minutes before concluding the
publish failed:

```bash
for i in $(seq 1 18); do
  npm view "$PKG@$VER" version 2>/dev/null | grep -q "$VER" && break
  sleep 10
done
npm view "$PKG@$VER" version dist.tarball time --json
npm dist-tag ls "$PKG"
npm view "$PKG" versions --json
```

`npm dist-tag ls` is the clearer signal for `latest` when `npm view <pkg>
version` appears stale right after publication. Then install the published
version in a fresh temp directory and run the documented entry point or bin:

```bash
tmp=$(mktemp -d); cd "$tmp"
npm init -y >/dev/null
npm install "$PKG@$VER" --ignore-scripts
# run the bin or import the documented entry point
rm -rf "$tmp"
```

### Tag and GitHub Release

Tag and release according to the repository's convention; do not move or
recreate a pushed tag. If there is no convention, a lightweight `v<version>` tag
plus a release whose notes are written from the changelog section or the commits
since the previous tag is a safe default:

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z --verify-tag --latest --title "vX.Y.Z" \
  --notes-file /tmp/release-notes.md
```

Author the notes from the changelog section for that version: a short
Highlights list of user-facing changes and an explicit Breaking change block
when one exists, ending with a link to the changelog. Drop commit hashes and
internal churn; `gh` must be authenticated (`gh auth status`).

A version published before this process existed may have no tag and no
release. To backfill one, tag the historical release commit — the
`chore(release)` commit, not today's HEAD — push the tag, and create the
release with `--latest=false` so the current release keeps the Latest label;
open the notes with a line saying they are backfilled.

If a published version is wrong, prefer `npm deprecate` with a clear message.
Unpublishing is restricted and breaks consumers; do not reach for it first.

## Failure Handling

| Failure | Likely cause | Response |
|---|---|---|
| cannot publish over previously published versions | Local version already exists | Ask for the new version, bump, sync lockfile and changelog, rerun checks |
| `npm publish` returns 404 or permission denied | Not logged in; login and publish are separate auth moments | `npm login --auth-type=web` first, then publish |
| E403 or not permitted to publish | Registry mirror, missing scope permission, or access setting | Confirm the target registry and access; do not silently switch registries |
| EOTP | Account requires 2FA for publishing | Rerun under `expect` with raw output to a file, open the auth URL, let it poll; or `--otp` with a user-supplied code |
| Auth URL is `***` or never surfaces | Publish output was piped through a filter, or no real TTY | Rerun as a background task with raw output; grep the output file, never the pipe |
| Auth URL 404s while the CLI keeps polling | ENTER arrived before the prompt, or the browser lacks the npm session or WebAuthn | Rerun under `expect`; otherwise reopen in the logged-in browser and finish the passkey step |
| Auth URL redirects to `/escalate/webauthn` | npm escalated publish authorization to a passkey confirmation | Expected, not an error — confirm the passkey in the logged-in browser; the CLI poll keeps running |
| `changeset version` fails with missing or invalid frontmatter | A hand-authored changeset file lacks its opening `---` delimiter | Add the delimiter to each file and rerun; run the version flow once before the release to catch this early |
| npm view E404 right after a successful publish | Registry processing lag | Poll the exact version and `dist-tag ls` for up to three minutes |
| `latest` appears stale after success | Registry/cache delay | Query `npm dist-tag ls` and the exact `name@version` |
| Dry-run misses an entry point, bin, or asset | `files` whitelist or `.npmignore` regression | Fix packaging and rerun; do not publish |
| Dry-run carries secrets, `.env`, or local state | No `files` whitelist or a bad `.npmignore` | Narrow the package contents before publishing |
| Dry-run misses `dist/` or shows stale output | `prepublishOnly` does not run for `npm pack` | Build before packing |
| `prepublishOnly` or `prepare` fails | Release gate failure | Fix the script or the build; do not bypass with `--ignore-scripts` |
| Workspace protocol error during pack | `workspace:*` or a workspace package was not built | Pack from the workspace root or run the project's build/publish wrapper |
| Bin command fails after tarball install | `bin` path, shebang, executable bit, or bundle issue | Fix before publishing and rerun the smoke test |
| Peer warning during install smoke | Local link does not resolve the host peer | Expected in many setups; verify the real entry point |
| Tests fail after the version bump | Hardcoded expected version | Read the version from the manifest instead |
| Local checks pass but CI fails on a root step | The bump touched files only the workflow's root steps check | Mirror the workflow's full step list locally; re-derive it when the workflow changes |
| `gh run watch` reported green but the build failed | Watched the wrong run (`--limit 1` picked another workflow or commit) | Watch by workflow name and the pushed commit's SHA |
| npm errors with EPERM on the `~/.npm` cache | Cache dir has root-owned files | `sudo chown -R $(id -u):$(id -g) ~/.npm`, or use a temp cache via `--cache` |
| `npm login` fails writing `~/.npmrc` (EPERM) | Home dir not writable from the sandbox | Log in with `--userconfig <tmp>` and pass the same flag to publish; delete the file afterward |
| Provenance publish fails | Missing `id-token: write` or unsupported CI | Fix the workflow permissions; local publish cannot attest |

## Command Sequence

Default skeleton; replace every placeholder from the audit:

```bash
git status --short

PKG=$(node -p "require('./package.json').name")   # run in the package directory
VER=$(node -p "require('./package.json').version")

npm config get registry
npm whoami
npm view "$PKG" version dist-tags --json

# confirm the exact version with the user, then bump via the project's mechanism
# run the release impact check, update the changelog in the project's format
# run the project's checks, mirroring the release workflow's steps
npm pack --dry-run --json

# tarball install smoke test

# summarize name, version, tag, registry, access, contents; ask for confirmation

npm whoami || npm login --auth-type=web
npm publish   # --access public for scoped; --tag next for a prerelease;
              # --registry <url> when the default registry is a read-only mirror

npm view "$PKG@$VER" version dist.tarball time --json
npm dist-tag ls "$PKG"
# tag, push, release notes from the changelog section, then install from the registry once more
```

Keep the release commit separate from unrelated feature work. Do not amend or
force-push a pushed release commit; fix forward.
