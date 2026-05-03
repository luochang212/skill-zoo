<div align="right">
  <a title="English" href="README.md"><img src="https://img.shields.io/badge/-English-A31F34?style=for-the-badge" alt="English" /></a>
  <a title="简体中文" href="README_zh-CN.md"><img src="https://img.shields.io/badge/-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-545759?style=for-the-badge" alt="简体中文"></a>
</div>

# Skill Zoo

![app-screenshot](docs/header-image.webp)

本地 Agent Skills 管理器 — 发现、安装、管理 Claude Code、Codex、Cursor、Gemini 等 AI 编程工具的技能。

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

## 📜 开源协议

[MIT](LICENSE)
