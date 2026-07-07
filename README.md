<div align="right">
  <a title="English" href="README.md"><img src="https://img.shields.io/badge/-English-A31F34?style=for-the-badge" alt="English" /></a>
  <a title="简体中文" href="README_zh-CN.md"><img src="https://img.shields.io/badge/-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-545759?style=for-the-badge" alt="简体中文"></a>
</div>

# Skill Zoo

[![Release](https://img.shields.io/github/v/release/luochang212/skill-zoo?style=flat-square&color=0e7490)](https://github.com/luochang212/skill-zoo/releases)
[![Downloads](https://img.shields.io/github/downloads/luochang212/skill-zoo/total?style=flat-square&color=0e7490)](https://github.com/luochang212/skill-zoo/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-0e7490?style=flat-square)]()
[![License](https://img.shields.io/badge/license-MIT-0e7490?style=flat-square)](LICENSE)
[![CI](https://github.com/luochang212/skill-zoo/actions/workflows/build.yml/badge.svg)](https://github.com/luochang212/skill-zoo/actions)

![app-screenshot](docs/header-image.webp)

Local Agent Skills Manager: Discover, install, and manage skills for AI coding tools including Claude Code, Codex, Gemini, OpenCode, Cursor, Trae, Hermes, OpenClaw and more.

## ✨ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript 6 + Vite 8 |
| Backend | Rust (Tauri v2) |
| Styling | Tailwind CSS 4 + shadcn/ui |
| State | TanStack React Query |
| Animation | Framer Motion |
| i18n | i18next |
| Lint | oxlint + clippy |
| Format | oxfmt + cargo fmt |
| Testing | Vitest + Rust tests |
| Package Manager | Bun |

## 🚀 Features

- **Explore & Install**: Search and download skills from GitHub repositories
- **Update Skills**: Update installed skills to the latest version from GitHub
- **Skill Authoring**: Built-in Markdown editor to create skills anywhere, anytime
- **Batch Operations**: Install, delete, or merge duplicate skills in bulk
- **Security Audit**: View community audit scores from skills.sh
- **Consistency Check**: Proactively detect three types of inconsistencies and prompt fixes
- **Skill Archive**: Move skills into the archive as temporary storage to reduce context load
- **CLI + WUI**: Provide Skill Zoo control surfaces for Coding Agents and humans

## 🙌 CLI

When you want to manage Skill Zoo from a coding agent, terminal, or automation, install the npm CLI:

```bash
npm i -g skill-zoo
skill-zoo --help

skill-zoo list           # List installed skills
skill-zoo doctor --fix   # Diagnose and fix common issues
skill-zoo wui            # Start the local Web UI
```

See: [Skill Zoo CLI](https://www.npmjs.com/package/skill-zoo)

## 📦 Installation

Download the latest build from [Releases](https://github.com/luochang212/skill-zoo/releases).

### macOS

1. Download the `.dmg`.
2. Open it and drag `skill-zoo.app` into `Applications`.

### Windows

1. Download the `.exe` installer.
2. Run it. The installer creates shortcuts and supports automatic updates.

**Note:** If SmartScreen shows a warning, click **"More info"** and then **"Run anyway"**.

### Linux

Download the AppImage for your CPU architecture, then run:

```bash
chmod +x Skill-Zoo-*-Linux-*.AppImage
./Skill-Zoo-*-Linux-*.AppImage
```

## 😇 Trust & Security

- **Auditable Code**: 100% open source. Every build runs on GitHub Actions for anyone to inspect.
- **Connects On Demand**: No background polling. Network only fires on browse or install.
- **You Stay in Control**: Any operation that touches real files (delete, move, overwrite) asks for confirmation first.

## 💡 Contributing

For development, see [docs/development.md](docs/development.md).

Found a bug or have an idea? Open an [issue](https://github.com/luochang212/skill-zoo/issues) or submit a PR. Contributions of all kinds are welcome!

## 📜 License

[MIT](LICENSE)
