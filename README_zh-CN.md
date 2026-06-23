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

本地 Agent Skills 管理工具 — 发现、安装、管理 Claude Code、Codex、Gemini、OpenCode、Cursor、Trae、Hermes、OpenClaw 等 AI 编程工具的技能。

<!-- ## 为什么选择 Skill Zoo？

AI 编程工具越来越多 — Claude Code、Cursor、Codex、Gemini。每个工具把技能存在不同目录。没有 Skill Zoo 之前，管理技能意味着：

- 在多个编程工具目录之间手动复制文件
- 无法发现社区中有哪些技能
- 看不到哪些技能安装到了哪里
- 同一技能的多个副本各自修改，逐渐产生差异

Skill Zoo 让你在一个地方**浏览**、**安装**、**编辑**和**同步**所有 AI 编程工具的 skill。它是一个拥有专用界面设计的文件管理器 — 本地优先，无云端，无锁定。

![Demo](docs/demo.gif) -->

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
| 代码检查 | oxlint + clippy |
| 格式化 | oxfmt + cargo fmt |
| 测试 | Vitest + Rust tests |
| 包管理 | Bun |

## 🚀 功能

- **探索发现**：搜索 & 下载 GitHub 上的技能
- **更新技能**：将技能更新到 GitHub 仓库上的最新版本
- **技能创作**：内置 Markdown 编辑器，随时随地创造技能
- **批量操作**：批量安装、删除、合并重复技能
- **安全审计**：展示来自 skills.sh 社区的审计评分
- **技能审查**：主动检测三种不一致情形，提醒用户修复问题
- **技能归档**：将技能转到归档区暂存，降低上下文负担
- **CLI + WUI**：为 Coding Agent 和人类提供 Skill Zoo 的控制入口

## 🙌 CLI

当你希望从编程工具、终端或自动化脚本中管理 Skill Zoo 时，可以安装 npm CLI：

```bash
npm i -g skill-zoo
skill-zoo --help

skill-zoo list           # 列出已安装技能
skill-zoo doctor --fix   # 诊断并修复常见问题
skill-zoo wui            # 启动本地 Web 管理界面
```

参考：[Skill Zoo CLI](https://www.npmjs.com/package/skill-zoo)

## 📦 安装

从 [Releases](https://github.com/luochang212/skill-zoo/releases) 下载最新版安装包。

### macOS

1. 下载 `.dmg` 文件。
2. 打开后将 `skill-zoo.app` 拖入 `Applications` 文件夹。

### Windows

1. 下载 `.exe` 安装包。
2. 运行安装包。安装程序会自动创建快捷方式并支持自动更新。

**注意：** 如果 SmartScreen 弹出警告，点击 **“更多信息”**，然后点击 **“仍要运行”**。

### Linux

下载与你 CPU 架构匹配的 AppImage，然后运行：

```bash
chmod +x Skill-Zoo-*-Linux-*.AppImage
./Skill-Zoo-*-Linux-*.AppImage
```

## 😇 信任与安全

- **代码可见** — 全部源码开源，构建过程由 GitHub Actions 自动完成，任何人都可以审计
- **按需联网** — 不后台偷跑，只在用户主动触发操作时请求 GitHub / skills.sh API
- **操作经你确认** — 所有涉及真实文件的操作（删除、移动、覆盖）都会弹出确认，由你拍板

## 💡 贡献代码

开发者请参考 [docs/development.md](docs/development.md)。

发现 bug 或有新功能想法？欢迎提交 [Issue](https://github.com/luochang212/skill-zoo/issues)，也欢迎直接发 Pull Request。

## 📜 开源协议

[MIT](LICENSE)
