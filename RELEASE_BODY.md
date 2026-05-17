## Installation Guide

### 🚀 What's New

__COMMITS__

### ⬇️ Download

> Download files are listed in the **Assets** section below.

| File | Platform |
| --- | --- |
| `Skill-Zoo-__VERSION__-macOS.dmg` | macOS (Universal — Intel & Apple Silicon) |
| `Skill-Zoo-__VERSION__-Windows.exe` | Windows Installer |
| `Skill-Zoo-__VERSION__-Windows-Portable.zip` | Windows Portable |

### 📦 Install

**macOS**: Download the `.dmg`, open it, and drag `skill-zoo.app` into `Applications`. If you see a warning that the app is damaged or macOS suggests moving it to Trash, open Terminal and run:

```bash
xattr -d com.apple.quarantine /Applications/skill-zoo.app
```

> **Note:** We don't have an Apple Developer account ($99/year), so the app cannot be signed or notarized. `xattr -d` removes the quarantine flag that macOS attaches to unsigned apps, allowing it to launch normally. This only needs to be done once.

<details>
<summary>Install via Homebrew (macOS developers)</summary>

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
<summary>Installer (alternative)</summary>

Download `Skill-Zoo-__VERSION__-Windows.exe` and run it. The installer will set up shortcuts automatically. SmartScreen may also show a warning — handle it the same way.

</details>

<details>
<summary>🇨🇳 中文安装指南</summary>

## 安装指南

### 🚀 更新内容

__COMMITS__

### ⬇️ 下载

> 下载文件在下方 **Assets** 区域中。

| 文件 | 平台 |
| --- | --- |
| `Skill-Zoo-__VERSION__-macOS.dmg` | macOS（通用 — Intel 和 Apple Silicon） |
| `Skill-Zoo-__VERSION__-Windows.exe` | Windows 安装版 |
| `Skill-Zoo-__VERSION__-Windows-Portable.zip` | Windows 便携版 |

### 📦 安装方法

**macOS**：下载 `.dmg` 文件，打开后将 `skill-zoo.app` 拖入 `Applications` 文件夹。如果 macOS 提示应用已损坏或建议移至废纸篓，请打开终端执行：

```bash
xattr -d com.apple.quarantine /Applications/skill-zoo.app
```

> **说明**：我们没有 Apple 开发者账号（$99/年），因此应用无法签名或公证。`xattr -d` 会移除 macOS 对未签名应用的隔离标记，使其可以正常启动。此操作只需执行一次。

<details>
<summary>通过 Homebrew 安装（macOS 开发者）</summary>

```bash
brew tap luochang212/tap
brew install --cask skill-zoo
```

更新：

```bash
brew upgrade --cask skill-zoo
```

首次启动同样需要执行 `xattr -d com.apple.quarantine /Applications/skill-zoo.app`。

</details>

---

**Windows**：下载便携版，解压到任意文件夹，双击 `.exe` 运行。如果出现 SmartScreen 警告，点击 **"更多信息"** → **"仍要运行"**。

<details>
<summary>安装版（备选）</summary>

下载 `Skill-Zoo-__VERSION__-Windows.exe` 并运行，安装程序会自动创建快捷方式。SmartScreen 可能同样出现警告，处理方式相同。

</details>

</details>
