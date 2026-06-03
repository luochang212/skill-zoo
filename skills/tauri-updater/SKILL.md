---
name: tauri-updater
description: Use when adding software auto-update to a Tauri 2 desktop app, or when users ask about tauri-plugin-updater integration, app update checking, distinguishing installer vs portable builds for updates, or generating update manifests for GitHub Releases.
---

# Tauri Updater

## Overview

Add self-update to a Tauri 2 desktop app using `tauri-plugin-updater`. Covers macOS DMG, Windows NSIS (auto-install), and Windows portable (manual download link). Uses a GitHub Releases-hosted `latest.json` manifest with signed artifacts.

## When to Use

- User asks to add "auto-update", "software update", "check for updates" to a Tauri app
- User asks about `tauri-plugin-updater` integration
- User wants to distinguish installer vs portable builds for update behavior
- User needs to generate update manifests for CI

**Don't use for:**
- Tauri 1.x apps (different updater API)
- Mobile apps (different update mechanisms)
- Apps distributed only via app stores (use store update mechanisms)

## Architecture

### Installer vs Portable

Tauri updater only works with installers (NSIS, MSI, DMG). Portable builds need a different path.

| Build | Update method | Implementation |
|-------|-------------|----------------|
| macOS DMG | Auto-download + install | `tauri-plugin-updater` full flow |
| Windows NSIS | Auto-download + install | `tauri-plugin-updater` full flow |
| Windows Portable | Link to GitHub Releases | Button opens releases page |

**Detecting portable at runtime**: Use a Cargo feature flag:

```toml
# Cargo.toml
[features]
portable = []
```

```rust
// Rust command
#[tauri::command]
pub fn is_portable_build() -> bool {
    cfg!(feature = "portable")
}
```

Normal build: `cargo build --release`
Portable build: `cargo build --release --features portable`

In `lib.rs`, conditionally register the updater plugin — skip it when the `portable` feature is active:

```rust
#[cfg(all(desktop, not(feature = "portable")))]
app.handle()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .expect("Failed to register updater plugin");
```

When `is_portable_build()` returns `true`, the frontend shows a GitHub Releases link instead of the auto-update flow.

## Implementation Steps

### 1. Generate Signing Key (one-time)

```bash
bun tauri signer generate -w ~/.tauri/<app-name>.key
```

Hit enter twice for empty password. Produces:
- `~/.tauri/<app-name>.key` — private key → store as GitHub Secret `TAURI_SIGNING_PRIVATE_KEY`
- `~/.tauri/<app-name>.key.pub` — public key → paste into `tauri.conf.json`

Empty password is fine — the key lives in encrypted GitHub Secrets. Adding a password means also managing `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in CI.

### 2. Rust Backend

**`src-tauri/Cargo.toml`**:

```toml
[features]
portable = []

[dependencies]
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

**`src-tauri/src/lib.rs`**:

```rust
// Always register process plugin (needed for relaunch after update)
.plugin(tauri_plugin_process::init())
.setup(|app| {
    // Skip updater for portable builds
    #[cfg(all(desktop, not(feature = "portable")))]
    app.handle()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .expect("Failed to register updater plugin");

    Ok(())
})
```

Register `is_portable_build` as a Tauri command in the invoke handler.

**Command file** (e.g. `commands/settings.rs`):

```rust
#[tauri::command]
pub fn is_portable_build() -> bool {
    cfg!(feature = "portable")
}
```

### 3. Tauri Configuration

**`src-tauri/tauri.conf.json`**:

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "<PUBLIC KEY FROM .pub FILE>",
      "endpoints": [
        "https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
      ]
    }
  }
}
```

The `releases/latest/download/` URL pattern uses GitHub's redirect to always serve the latest release's asset.

Update CSP `connect-src` to allow GitHub release asset domains:
```
connect-src 'self' ipc: http://ipc.localhost https://api.github.com https://github.com https://objects.githubusercontent.com https://github-releases.githubusercontent.com
```

**`src-tauri/capabilities/default.json`** — add permissions:

```json
{
  "permissions": [
    "updater:default",
    "process:default",
    "process:allow-restart"
  ]
}
```

### 4. Frontend

**Install**:

```bash
bun add @tauri-apps/plugin-updater@^2 @tauri-apps/plugin-process@^2
```

**State machine**:

```
idle → checking → up-to-date
                → downloading → ready-to-restart
                → available (download retry) → downloading → ready-to-restart
                → error → idle (retry)

Portable: always shows "GitHub Releases" link button
```

| State | UI | Action |
|-------|----|--------|
| `idle` | "Check for Updates" button | `check()` |
| `checking` | Spinner, disabled button | Wait |
| `up-to-date` | "Up to date" | None |
| `downloading` | Version number + cumulative byte progress | Wait |
| `available` | Version number + "Download & Install" | Retry `downloadAndInstall()` after a download failure |
| `ready-to-restart` | "Restart Now" button | `relaunch()` |
| `error` | Friendly message + Retry | `check()` |

**Key API details**:

- `check()` returns `null` when up-to-date (not an error)
- `check()` throws on network failure or 404 (manifest doesn't exist yet) — show friendly message, not raw error
- `downloadAndInstall()` progress callback: use `event.data.chunkLength` (not `position`/`length`). Track cumulative bytes with a state updater.
- Store the `Update` object in a `useRef` to avoid stale closure in the progress callback.

**Error handling pattern** — never expose raw errors:

```tsx
try {
  const result = await check();
  if (result) { /* downloadAndInstall() immediately */ }
  else { /* up-to-date */ }
} catch {
  // Network error, 404, rate limit, etc.
  setStatus("error");  // shows friendly t("updater.error") message
}
```

### 5. CI Pipeline

**Build job** — pass signing key:

```yaml
- name: Tauri build
  uses: tauri-apps/tauri-action@v0
  env:
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
  with:
    args: --target ${{ matrix.target }}
```

**Rename updater artifacts** (after build, before upload):

```yaml
- name: Rename updater artifacts
  shell: bash
  run: |
    case "${{ matrix.target }}" in
      universal-apple-darwin)
        TAR=$(find "$BUNDLE/macos" -name "*.app.tar.gz" | head -1)
        [ -n "$TAR" ] && mv "$TAR" "$BUNDLE/<App>-${VERSION}-macOS.app.tar.gz"
        [ -f "${TAR}.sig" ] && mv "${TAR}.sig" "$BUNDLE/<App>-${VERSION}-macOS.app.tar.gz.sig"
        ;;
      x86_64-pc-windows-msvc)
        EXE_SIG=$(find "$BUNDLE/nsis" -name "*.exe.sig" | head -1)
        [ -f "$EXE_SIG" ] && mv "$EXE_SIG" "$BUNDLE/<App>-${VERSION}-Windows.exe.sig"
        ;;
    esac
```

**Windows portable rebuild**:

```yaml
- name: Create portable zip (Windows)
  if: matrix.target == 'x86_64-pc-windows-msvc'
  shell: pwsh
  run: |
    cargo build --release --manifest-path src-tauri/Cargo.toml --target ${{ matrix.target }} --features portable
    # ... package the portable binary as before
```

The `--features portable` flag compiles a binary where `is_portable_build()` returns `true` and the updater plugin is not registered.

**Generate `latest.json`** (in release job, after all artifacts are available):

```yaml
- name: Generate updater manifest
  run: |
    MACOS_SIG=$(cat artifacts/macos/*.app.tar.gz.sig 2>/dev/null || echo "")
    WINDOWS_SIG=$(cat artifacts/windows/*.exe.sig 2>/dev/null || echo "")

    jq -n \
      --arg version "$VERSION" \
      --arg pub_date "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
      --arg macos_sig "$MACOS_SIG" \
      --arg macos_url "https://github.com/<owner>/<repo>/releases/download/${VERSION}/<App>-${VERSION}-macOS.app.tar.gz" \
      --arg windows_sig "$WINDOWS_SIG" \
      --arg windows_url "https://github.com/<owner>/<repo>/releases/download/${VERSION}/<App>-${VERSION}-Windows.exe" \
      '{
        version: $version,
        notes: "",
        pub_date: $pub_date,
        platforms: {
          "darwin-x86_64": { signature: $macos_sig, url: $macos_url },
          "darwin-aarch64": { signature: $macos_sig, url: $macos_url },
          "windows-x86_64": { signature: $windows_sig, url: $windows_url }
        }
      }' > latest.json

- name: Upload manifest
  run: gh release upload "$TAG_NAME" latest.json
```

**macOS universal binary**: Both `darwin-x86_64` and `darwin-aarch64` point to the same `.app.tar.gz` with the same signature.

### Platform Artifacts Summary

| Build | Standard output | Updater artifact | Updater uses? |
|-------|----------------|-----------------|---------------|
| macOS universal | `<App>-*.dmg` | `<App>-*.app.tar.gz` + `.sig` | Yes (tar.gz) |
| Windows NSIS | `<App>-*.exe` | `<App>-*.exe` + `.sig` | Yes (exe re-used) |
| Windows Portable | `<App>-*-Portable.zip` | N/A | No (releases link) |

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Pushing tag before main | Always push main first. Tag on unpushed commit won't trigger CI on correct SHA |
| Forgetting `createUpdaterArtifacts` | No `.app.tar.gz` or `.sig` files will be generated |
| CSP blocking download | Add `objects.githubusercontent.com` and `github-releases.githubusercontent.com` to `connect-src` |
| Missing `process:allow-restart` | `relaunch()` fails silently |
| Showing raw errors to user | Catch and show friendly message. The first release won't have `latest.json` yet — that's a 404, not a bug |
| Wrong progress event fields | Tauri 2 uses `event.data.chunkLength`, not `position`/`length` |
| Treating `check()` null as error | `null` = no update available, it's a success case |
| Stale closure in download callback | Store `Update` in `useRef`, not just `useState` |
| Manifest URL case mismatch | `latest.json` in endpoints must match the uploaded filename exactly |
| Not cleaning up unused i18n keys | When replacing a manual releases button with updater UI, remove old translation keys |

## Post-Release Notes

- **First release**: Existing users won't have the updater code — they must download this release manually. After that, updates are automatic.
- **Homebrew**: The `.app.tar.gz` and `.sig` are separate from the DMG. Homebrew cask formulas are unaffected.
- **Signature errors**: If the updater reports signature verification failure, the pubkey in `tauri.conf.json` likely doesn't match the private key used in CI. Regenerate and redeploy.
- **Testing**: Build a newer version to test the full download-and-install flow end-to-end.
