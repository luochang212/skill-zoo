# Development

Local setup for the Skill Zoo desktop app, CLI, and project website.

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
├── site/                   # Independent Astro project website (see site/README.md)
├── docs/                   # Development, README images, and local protocol docs
├── fixtures/               # Desktop-owned local protocol fixtures
├── skills/                 # Project automation skills
├── package.json
└── vite.config.ts
```

## 🔧 Development

Prerequisites: [Bun](https://bun.sh/), [Node](https://nodejs.org/) 22.12+ (24 LTS is what CI and the current toolchain use), [Rust](https://www.rust-lang.org/tools/install) 1.90+ (the floor the dependency graph actually requires, since tauri 2.12 and friends declare 1.90), and a [Tauri setup](https://v2.tauri.app/start/prerequisites/).

Bun is the package manager, but Node is a hard requirement for the documented workflows: vitest runs its files in `node` fork workers, so `bun run test` fails with "Failed to start forks worker" when no `node` binary is on `PATH`. The CLI additionally declares `engines.node >= 22.12.0` because it depends on the ESM-only commander 15.

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

## 📌 依赖更新须知

依赖版本策略见 `AGENTS.md`（保持最新稳定版）。例外与历史教训记录在此，避免重复排查：

**`dirs` 已随上游从 6.x 升到 7（2026-10 依赖扫描），但不要抢在上游要求之前升级。** 此前 `tauri` 依赖 `dirs ^6`（核对过 2.11.5 与 3.0.0-alpha.1），semver 下无法与 7 统一；当时把 `Cargo.toml` 改成 `dirs = "7"` 的后果**不是编译报错，而是 cargo 去满足 tauri**：它会回溯 tauri 到旧版本（实测退到 2.2.0，连带 `tauri-build` 2.6.3 → 2.0.4）然后编译失败，所以当时刻意停在 6.x。tauri 自 2.12.5、wry 自 0.57.0 起要求 `dirs ^7`（`cargo tree -i dirs@7.0.0` 核实），迁移条件已满足，本仓库随之升到 7.0；我们只用到 `home_dir()` 与 `desktop_dir()`，签名在 6、7 中一致。规则不变：跟随上游要求升级，不要用 `[patch]` 覆盖上游声明。

**`serde_yaml` 已停止维护（`0.9.34+deprecated`），但刻意保留。** 它只用于解析 frontmatter 的 `name` 与 `description` 两个标量。已知的两个通告（RUSTSEC-2018-0005、GHSA-39vw-qp34-rmwf）均已在 0.8.4 修复，不在我们使用的 0.9.34 影响范围内；实测该版本对 alias 炸弹、自引用 alias、500 层深嵌套均返回 `Err(...)`（带限制），不会 abort。社区分叉中 `serde_yml` 有**未修复**的 "unsound and unmaintained" 通告（RUSTSEC-2025-0068，影响全部版本），不要采用（本仓库历史上曾从它换回 serde_yaml）。`serde_norway` 与 `serde_yaml_ng` 干净但同样不活跃，属同代码改名，收益很薄。若将来决定移除该依赖，正确方向是把解析收窄到只认这两个键，而不是换分叉。

## Project website

The public landing page is an independently built Astro site in `site/`. It uses
Node.js 22.22+ (CI uses Node 24) and npm, with its own lockfile. See
[site/README.md](../site/README.md) for local commands, browser checks, language
routes and the GitHub Pages migration/publishing procedure. The desktop build
does not build or publish the website.
