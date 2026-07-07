# Development

Local setup for the Skill Zoo desktop app and CLI.

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
├── packages/
│   └── cli/                # npm CLI and lightweight local Web UI
│       ├── src/            # CLI commands, local protocol, WUI server
│       ├── tests/          # CLI and protocol tests
│       └── wui/            # Browser assets served by skill-zoo wui
├── docs/                   # Screenshots and local protocol docs
├── fixtures/               # Desktop-owned local protocol fixtures
├── skills/                 # Project automation skills
├── package.json
└── vite.config.ts
```

## 🔧 Development

Prerequisites: [Bun](https://bun.sh/), [Rust](https://www.rust-lang.org/tools/install), and a [Tauri setup](https://v2.tauri.app/start/prerequisites/).

On Linux, install the system packages Tauri needs for desktop builds:

```bash
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

```bash
# Install dependencies
bun install

# Run in development mode
bun run tauri dev

# Type checking
bun run typecheck

# Lint and format
bun run lint
bun run format

# Run tests
bun run test
bun run cli:test

# Rust (backend)
bun run lint:rs
bun run format:rs:check
bun run test:rs

# CLI
bun run cli:typecheck
bun run cli:build

# Build for production
bun run tauri build
```

## 🇨🇳 国内镜像源

在中国大陆网络环境下，建议配置国内镜像源加速依赖下载。

**npm/bun 淘宝镜像：**

```bash
bun install --registry https://registry.npmmirror.com
```

**Cargo 镜像（字节跳动 RSProxy）：**

在 `~/.cargo/config.toml` 中添加：

```toml
[source.crates-io]
replace-with = 'rsproxy'

[source.rsproxy]
registry = 'sparse+https://rsproxy.cn/index/'
```

其他可选 Cargo 镜像：清华 TUNA (`mirrors.tuna.tsinghua.edu.cn/crates.io-index`)、阿里云 (`mirrors.aliyun.com/crates.io-index`)、中科大 USTC (`mirrors.ustc.edu.cn/crates.io-index`)、华为云 (`mirrors.huaweicloud.com/repository/rust/crates.io-index`)。
