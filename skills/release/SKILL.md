---
name: release
description: Use when the user wants to release a new version, publish a release, or ship a build. Covers version bumping, tag creation, CI verification, and Homebrew cask compatibility.
---

# Release

## Overview

Releasing a new version of Skill Zoo is done by pushing a `v*` tag. The CI handles builds, creates a GitHub Release with renamed artifacts, and updates the Homebrew cask formula.

**Announce at start:** "I'm using the release skill to ship a new version."

## Checklist

- [ ] 1. Confirm version number
- [ ] 2. Verify all changes are committed
- [ ] 3. Check RELEASE_BODY.md is current
- [ ] 4. Verify Homebrew cask URL pattern is correct
- [ ] 5. Tag and push
- [ ] 6. Monitor CI

## Step 1: Confirm Version

Ask the user which version they want to release. Check existing tags:

```bash
git tag --sort=-v:refname | head -5
```

The version must start with `v` (e.g., `v0.1.2`). Only `v*` tags trigger the release CI.

## Step 2: Verify Changes Are Committed

```bash
git status --short
```

There must be no uncommitted changes. If there are, commit them first or warn the user.

## Step 3: Check RELEASE_BODY.md

Read `RELEASE_BODY.md` and verify:
- The `__COMMITS__` placeholder is present for auto-generated changelogs
- The `__VERSION__` placeholder is used in download table file names, not hardcoded `vx.x.x`
- Install instructions are up to date

## Step 4: Verify Homebrew Cask URL

The cask at [luochang212/homebrew-tap](https://github.com/luochang212/homebrew-tap/blob/main/Casks/skill-zoo.rb) must have URL patterns matching the renamed artifacts:

```ruby
# ARM
url ".../Skill-Zoo-v#{version}-macOS-arm64.dmg"
# Intel
url ".../Skill-Zoo-v#{version}-macOS-x64.dmg"
```

The CI only updates `version` and `sha256` in the formula at release time — it does not fix URL mismatches. If the URL is wrong, the formula will 404 for all users. Correct it before releasing.

```bash
gh api repos/luochang212/homebrew-tap/contents/Casks/skill-zoo.rb --jq '.content' | base64 -d
```

## Step 5: Tag and Push

```bash
git push origin main
git tag v<VERSION>
git push origin v<VERSION>
```

## Step 6: Monitor CI

After pushing the tag, the CI triggers three jobs:

| Job | What it does |
|---|---|
| **build** | Builds macOS arm64/x64 DMGs and Windows NSIS installer + portable zip. Renames all to `Skill-Zoo-v{VERSION}-{platform}.{ext}`. |
| **create-release** | Downloads artifacts, substitutes `__VERSION__` and `__COMMITS__` in `RELEASE_BODY.md`, creates the GitHub Release. |
| **update-homebrew** | Computes SHA256 of both DMGs, updates the cask formula in `luochang212/homebrew-tap`, opens a PR. |

Watch the [Actions tab](https://github.com/luochang212/skill-zoo/actions) for failures.

## Post-Release

- If `update-homebrew` succeeded, merge the auto-generated PR in `luochang212/homebrew-tap`.
- Verify the [GitHub Release](https://github.com/luochang212/skill-zoo/releases) page shows correct assets and release notes.
