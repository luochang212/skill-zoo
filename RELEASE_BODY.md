## Installation Guide

### 🚀 What's New

__COMMITS__

### ⬇️ Download

| File | Platform |
| --- | --- |
| `Skill-Zoo-__VERSION__-macOS-arm64.dmg` | macOS Apple Silicon (M1/M2/M3/M4) |
| `Skill-Zoo-__VERSION__-macOS-x64.dmg` | macOS Intel |
| `Skill-Zoo-__VERSION__-Windows.exe` | Windows Installer |
| `Skill-Zoo-__VERSION__-Windows-Portable.zip` | Windows Portable |

### 📦 Install

**macOS**: Download the `.dmg` matching your chip, open it, and drag `skill-zoo.app` into `Applications`. If you see a warning that the app is damaged or macOS suggests moving it to Trash, open Terminal and run:

```bash
xattr -d com.apple.quarantine /Applications/skill-zoo.app
```

> **Note:** We don't have an Apple Developer account ($99/year), so the app cannot be signed or notarized. `xattr -d` removes the quarantine flag that macOS attaches to unsigned apps, allowing it to launch normally. This only needs to be done once.

<details>
<summary>🧑‍💻 Install via Homebrew (macOS developers)</summary>

```bash
brew tap luochang212/tap
brew install --cask skill-zoo
```

Update:

```bash
brew upgrade --cask skill-zoo
```

You'll also need to run `xattr -d com.apple.quarantine /Applications/skill-zoo.app` on first launch.

</details>

---

**Windows**: Download the portable version, extract it to any folder, and double-click the `.exe` to run. If SmartScreen shows a warning, click **"More info"** → **"Run anyway"**.

<details>
<summary>📦 Installer (alternative)</summary>

Download `Skill-Zoo-__VERSION__-Windows.exe` and run it. The installer will set up shortcuts automatically. SmartScreen may also show a warning — handle it the same way.

</details>
