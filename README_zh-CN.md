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

本地 Agent Skills 管理器 — 发现、安装、管理 Claude Code、Codex、Cursor、Gemini 等 AI 编程工具的技能。

<!-- ## 为什么选择 Skill Zoo？

AI 编程工具越来越多 — Claude Code、Cursor、Codex、Gemini。每个工具把技能存在不同目录。没有 Skill Zoo 之前，管理技能意味着：

- 在多个 Agent 目录之间手动复制文件
- 无法发现社区中有哪些技能
- 看不到哪些技能安装到了哪里
- 同一技能的多个副本各自修改，逐渐产生差异

Skill Zoo 让你在一个地方**浏览**、**安装**、**编辑**和**同步**所有 AI 编程工具的 skill。它是一个拥有专用界面设计的文件管理器 — 本地优先，无云端，无锁定。

![Demo](docs/demo.gif) -->

## 🚀 功能

- **浏览发现**：探索 GitHub 和 [skills.sh](https://skills.sh/) 上的技能仓库
- **一键安装**：从 GitHub 仓库批量安装技能，并链接到指定 Agent
- **技能创作**：内置 Markdown 编辑器，支持编辑技能文件
- **一致性检查**：支持同名技能检测、文件格式检测，对同名同 hash 技能可一键去重
- **多 Agent 支持**：支持 Claude Code、Cursor、Codex 等 AI 编程助手
- **明暗主题**：默认跟随系统，支持手动切换
- **国际化**：支持英文和简体中文

## ✨ 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript 6 + Vite 8 |
| 后端 | Rust（Tauri v2） |
| 样式 | Tailwind CSS 4 + shadcn/ui |
| 状态 | TanStack React Query |
| 动画 | Framer Motion |
| 国际化 | i18next |
| 编辑器 | CodeMirror 6 |
| 包管理 | Bun |

## 📦 安装

### macOS

从 [Releases](https://github.com/luochang212/skill-zoo/releases) 页面下载对应芯片的 `.dmg` 文件，打开后将 `skill-zoo.app` 拖入 `Applications` 文件夹。

> 如果提示”skill-zoo 已损坏，无法打开”，请在终端执行 `xattr -d com.apple.quarantine /Applications/skill-zoo.app`。
>
> **说明：** 我们没有 Apple 开发者账号（$99/年），因此应用无法签名或公证。`xattr -d` 用于移除 macOS 对未签名应用附加的隔离标记，只需执行一次。

<details>
<summary>🧑‍💻 通过 Homebrew 安装（macOS 开发者）</summary>

```bash
brew tap luochang212/tap
brew install --cask skill-zoo
```

首次启动同样需要执行 `xattr -d com.apple.quarantine /Applications/skill-zoo.app`。

</details>

### Windows

从 [Releases](https://github.com/luochang212/skill-zoo/releases) 下载便携版，解压到任意文件夹，运行 `skill-zoo.exe`。

> 如果 SmartScreen 弹出警告，点击 **”更多信息”** → **”仍要运行”**。

<details>
<summary>📦 安装包（备选）</summary>

从 [Releases](https://github.com/luochang212/skill-zoo/releases) 下载 `.exe` 安装包运行即可。SmartScreen 同样可能弹出警告，按上述方式处理。

</details>

## 📁 项目结构

```
skill-zoo/
├── src/                    # React 前端
│   ├── components/
│   │   ├── skills/         # 技能浏览、详情、安装、创建
│   │   ├── settings/       # 主题、语言、维护、关于
│   │   ├── layout/         # 顶部导航
│   │   └── ui/             # shadcn/ui 基础组件
│   ├── hooks/              # React Query Hooks & 缓存失效
│   ├── i18n/               # 多语言（英文、中文）
│   ├── lib/                # Tauri API 客户端、Agent 配置、平台工具
│   └── types/              # TypeScript 类型定义
├── src-tauri/              # Tauri + Rust 后端
│   ├── src/
│   │   ├── commands/       # Tauri IPC 命令处理
│   │   ├── services/       # 技能操作、CLI 管理、锁文件
│   │   ├── persistence/    # 元数据和设置持久化
│   │   ├── config.rs       # Agent 配置与路径检测
│   │   ├── store.rs        # 应用状态
│   │   └── error.rs        # 错误类型
│   ├── resources/          # 轮播图、推荐仓库
│   ├── Cargo.toml
│   └── tauri.conf.json
├── docs/                   # 截图
├── package.json
└── vite.config.ts
```

## 🔧 开发

前置条件：[Bun](https://bun.sh/)、[Rust](https://www.rust-lang.org/tools/install) 和 [Tauri 环境](https://v2.tauri.app/start/prerequisites/)。

```bash
# 安装依赖
bun install

# 开发模式运行
bun run tauri dev

# 类型检查
bun run typecheck

# 生产构建
bun run tauri build
```

## 🛡️ 信任与安全

- 🔓 **代码可见** — 全部源码开源，构建过程由 GitHub Actions 自动完成，任何人都可以审计
- 🔐 **按需联网** — 不后台偷跑，只在用户主动触发操作时请求 GitHub / skills.sh API
- ⚠️ **操作经你确认** — 所有涉及真实文件的操作（删除、移动、覆盖）都会弹出确认，由你拍板

## 🤝 贡献代码

发现 bug 或有新功能想法？欢迎提交 [Issue](https://github.com/luochang212/skill-zoo/issues)，也欢迎直接发 Pull Request。

## 📜 开源协议

[MIT](LICENSE)
