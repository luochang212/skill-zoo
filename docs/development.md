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