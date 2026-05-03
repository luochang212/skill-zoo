# Release Guide

## 1. Confirm Version

Decide the new version number (e.g., `v0.1.2`). Check existing tags:

```bash
git tag --sort=-v:refname | head -5
```

## 2. Verify Before Pushing

- All changes committed. No uncommitted work in the repo.
- `RELEASE_BODY.md` is up to date with any new install instructions or notes.
- The Homebrew cask formula at [luochang212/homebrew-tap](https://github.com/luochang212/homebrew-tap) has the correct URL pattern: `Skill-Zoo-v#{version}-macOS-arm64.dmg` and `Skill-Zoo-v#{version}-macOS-x64.dmg`. The CI only updates version and SHA256 in the formula — it does not fix a mismatched URL.

## 3. Tag and Push

```bash
git push origin main
git tag v0.1.2
git push origin v0.1.2
```

The push of the `v*` tag triggers CI automatically.

## 4. What CI Does

Triggered by a tag matching `v*`:

1. **build** (macOS arm64, macOS x64, Windows) — builds the app, renames artifacts to `Skill-Zoo-v{version}-macOS-arm64.dmg`, `Skill-Zoo-v{version}-macOS-x64.dmg`, `Skill-Zoo-v{version}-Windows.exe`, and creates `Skill-Zoo-v{version}-Windows-Portable.zip`.
2. **create-release** — downloads all artifacts, generates release notes from `RELEASE_BODY.md`, creates the GitHub Release with `gh release create`.
3. **update-homebrew** — computes SHA256 of both DMGs, updates the cask in `luochang212/homebrew-tap`, opens a PR.

## 5. Post-Release

- Check the [Actions tab](https://github.com/luochang212/skill-zoo/actions) for failures.
- If `update-homebrew` succeeds, merge its auto-generated PR in the homebrew-tap repo.
- Verify the GitHub Release page has the correct assets and notes.
- Test `brew upgrade --cask skill-zoo` if on macOS.
