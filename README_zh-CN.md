<div align="right">
  <a title="English" href="README.md"><img src="https://img.shields.io/badge/-English-A31F34?style=for-the-badge" alt="English" /></a>
  <a title="简体中文" href="README_zh-CN.md"><img src="https://img.shields.io/badge/-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-545759?style=for-the-badge" alt="简体中文"></a>
</div>

# Skill Zoo

本地 AI Agent 技能管理器 — 浏览、安装、管理 Claude Code、Codex、Cursor、Gemini 等工具的技能。

![app-screenshot](docs/screenshots/screenshot-1.webp)

## 功能

- **浏览发现** — 探索 GitHub 上的技能仓库，轮播图和推荐仓库
- **一键安装** — 安装技能到共享目录 `~/.agents/skills/`，并软链接到目标 Agent
- **技能详情** — 内置 Markdown 编辑器和文件树，查看、编辑技能文件
- **技能创建** — 创建新技能并部署到选定的 Agent
- **重复检测** — 发现跨目录的同名技能并合并
- **多 Agent 支持** — Claude Code、Codex、Gemini、Cursor、Trae、Trae CN、Hermes、OpenClaw
- **深浅色主题** — 默认跟随系统，支持手动切换
- **国际化** — 支持英文和简体中文

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite 8 |
| 后端 | Rust（Tauri v2） |
| 样式 | Tailwind CSS 4 + shadcn/ui |
| 状态 | TanStack React Query |
| 动画 | Framer Motion |
| 国际化 | i18next |
| 编辑器 | CodeMirror 6 |
| 包管理 | Bun |

## 安装

### GitHub Releases

从 [Releases](https://github.com/luochang212/skill-zoo/releases) 页面下载最新版本：

- **macOS** — `.dmg`（Apple Silicon / Intel）
- **Windows** — `.msi` 或 `.exe`

> macOS 用户：如果提示"应用已损坏，无法打开"，请在终端中执行 `xattr -d com.apple.quarantine /Applications/skill-zoo.app`。

### Homebrew

```bash
brew tap luochang212/skill-zoo
brew install skill-zoo
```

## 开发

前置条件：[Bun](https://bun.sh)、[Rust](https://www.rust-lang.org/tools/install)（1.85+）

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

## 项目结构

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
│   │   ├── services/       # 技能操作、CLI 增删、锁文件
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

## 开源协议

[MIT](LICENSE)
