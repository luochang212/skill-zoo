<div align="right">
  <a title="English" href="README.md"><img src="https://img.shields.io/badge/-English-A31F34?style=for-the-badge" alt="English" /></a>
  <a title="简体中文" href="README_zh-CN.md"><img src="https://img.shields.io/badge/-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-545759?style=for-the-badge" alt="简体中文"></a>
</div>

# Skill Zoo

[![Release](https://img.shields.io/github/v/release/luochang212/skill-zoo?style=flat-square&color=0e7490)](https://github.com/luochang212/skill-zoo/releases)
[![Downloads](https://img.shields.io/github/downloads/luochang212/skill-zoo/total?style=flat-square&color=0e7490)](https://github.com/luochang212/skill-zoo/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-0e7490?style=flat-square)]()
[![License](https://img.shields.io/badge/license-MIT-0e7490?style=flat-square)](LICENSE)
[![CI](https://github.com/luochang212/skill-zoo/actions/workflows/build.yml/badge.svg)](https://github.com/luochang212/skill-zoo/actions)

![app-screenshot](docs/header-image.webp)

Local Agent Skills Manager — Discover, install, and manage skills for AI coding tools including Claude Code, Codex, Cursor, Gemini and more.

<!-- ## Why Skill Zoo?

AI coding tools are multiplying — Claude Code, Cursor, Codex, Gemini. Each stores skills in a different directory. Before Skill Zoo, managing skills meant:

- Manually copying files between agent directories
- No way to discover what skills exist in the community
- No visibility into which skills are installed where
- Divergent copies of the same skill silently drifting out of sync

Skill Zoo gives you a single place to **browse**, **install**, **edit**, and **sync** skills across all your AI coding tools. It's a file manager with a purpose-built UI — local-first, no cloud, no lock-in.

![Demo](docs/demo.gif) -->

## 🚀 Features

- **Browse & Discover**: Explore skill repositories on GitHub and [skills.sh](https://skills.sh/)
- **One-click Install**: Batch-install skills from GitHub repositories and symlink to target agents
- **Skill Authoring**: Built-in Markdown editor for editing skill files
- **Consistency Check**: Same-name skill detection, file format validation, and one-click deduplication for skills with identical name and hash
- **Multi-Agent Support**: Supports Claude Code, Cursor, Codex, and other AI coding assistants
- **Dark/Light Theme**: Follows system preference by default, with manual toggle
- **Multilingual**: English and Simplified Chinese

## ✨ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript 6 + Vite 8 |
| Backend | Rust (Tauri v2) |
| Styling | Tailwind CSS 4 + shadcn/ui |
| State | TanStack React Query |
| Animation | Framer Motion |
| i18n | i18next |
| Editor | CodeMirror 6 |
| Package Manager | Bun |

## 📦 Installation

### macOS

Download the `.dmg` matching your chip from the [Releases](https://github.com/luochang212/skill-zoo/releases) page, open it, and drag `skill-zoo.app` into `Applications`.

> If you see "skill-zoo" is damaged and can't be opened, run `xattr -d com.apple.quarantine /Applications/skill-zoo.app` in Terminal.
>
> **Note:** We don't have an Apple Developer account ($99/year), so the app cannot be signed or notarized. `xattr -d` removes the quarantine flag that macOS attaches to unsigned apps, allowing it to launch normally.

<details>
<summary>🧑‍💻 Install via Homebrew (macOS developers)</summary>

```bash
brew tap luochang212/tap
brew install --cask skill-zoo
```

You'll also need to run `xattr -d com.apple.quarantine /Applications/skill-zoo.app` on first launch.

</details>

### Windows

Download the portable version from [Releases](https://github.com/luochang212/skill-zoo/releases), extract it to any folder, and run `skill-zoo.exe`.

> If SmartScreen shows a warning, click **"More info"** → **"Run anyway"**.

<details>
<summary>📦 Installer (alternative)</summary>

Download the `.exe` installer from [Releases](https://github.com/luochang212/skill-zoo/releases) and run it. SmartScreen may also show a warning — same workaround applies.

</details>

## 📁 Project Structure

```
skill-zoo/
├── src/                    # React frontend
│   ├── components/
│   │   ├── skills/         # Skill browsing, detail, install, creation
│   │   ├── settings/       # Theme, language, maintenance, about
│   │   ├── layout/         # Top navigation
│   │   └── ui/             # shadcn/ui primitives
│   ├── hooks/              # React Query hooks & cache invalidation
│   ├── i18n/               # Translations (English, Chinese)
│   ├── lib/                # Tauri API client, agent config, platform utils
│   └── types/              # TypeScript type definitions
├── src-tauri/              # Tauri + Rust backend
│   ├── src/
│   │   ├── commands/       # Tauri IPC command handlers
│   │   ├── services/       # Skill operations, CLI management, lock file
│   │   ├── persistence/    # Metadata & settings persistence
│   │   ├── config.rs       # Agent config & path detection
│   │   ├── store.rs        # App state
│   │   └── error.rs        # Error types
│   ├── resources/          # Carousel banners, recommended repos
│   ├── Cargo.toml
│   └── tauri.conf.json
├── docs/                   # Screenshots
├── package.json
└── vite.config.ts
```

## 🔧 Development

Prerequisites: [Bun](https://bun.sh/), [Rust](https://www.rust-lang.org/tools/install), and a [Tauri setup](https://v2.tauri.app/start/prerequisites/).

```bash
# Install dependencies
bun install

# Run in development mode
bun run tauri dev

# Type checking
bun run typecheck

# Build for production
bun run tauri build
```

## 😇 Trust & Security

- **Code You Can Audit** — All source code is open and builds run fully on GitHub Actions; anyone can review what you're running
- **Connects On Demand** — No background polling; network requests only fire when you trigger an action like browsing or installing
- **You Stay in Control** — Any operation that touches real files (delete, move, overwrite) always asks you to confirm first

## 🤝 Contributing

Found a bug or have an idea? Open an [issue](https://github.com/luochang212/skill-zoo/issues) or submit a PR — contributions of all kinds are welcome!

## 📜 License

[MIT](LICENSE)
