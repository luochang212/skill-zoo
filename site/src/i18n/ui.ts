import { basePath } from '../lib/paths';

export type Lang = 'en' | 'zh';

export const messages = {
  "hero-subtitle": {
    "zh": "为 AI 编程助手打造的 Skill 桌面管理工具",
    "en": "Desktop skill manager for AI coding assistants"
  },
  "scroll": {
    "zh": "Scroll",
    "en": "Scroll"
  },
  "arch-eyebrow": {
    "zh": "架构",
    "en": "Architecture"
  },
  "arch-title": {
    "zh": "技术架构",
    "en": "Technical Architecture"
  },
  "arch-lead": {
    "zh": "三层结构：React 前端通过 Tauri IPC 与 Rust 后端通信。前端零文件系统、零网络访问，所有交互走类型化 Rust 命令；后端管理文件系统与外部服务。",
    "en": "Three-layer structure: React frontend communicates with Rust backend via Tauri IPC. Zero filesystem and network access from the frontend — all interactions go through typed Rust commands; the backend manages filesystem and external services."
  },
  "stat-platforms": {
    "zh": "桌面平台",
    "en": "Desktop Platforms"
  },
  "stat-langs": {
    "zh": "平台语言 (TS + Rust)",
    "en": "Languages (TS + Rust)"
  },
  "stat-agents": {
    "zh": "编程工具类型支持",
    "en": "Coding Agent Types"
  },
  "stat-shell": {
    "zh": "外部 shell 依赖",
    "en": "External Shell Deps"
  },
  "feat-eyebrow": {
    "zh": "功能",
    "en": "Features"
  },
  "feat-title": {
    "zh": "功能体系",
    "en": "Feature System"
  },
  "feat-lead": {
    "zh": "覆盖 Skill 的完整生命周期，从发现、安装到编辑、维护。6 大功能模块提供完整管理体验。",
    "en": "Covering the full Skill lifecycle: discover, install, edit, and maintain. Six modules for a complete management experience."
  },
  "feat-discover": {
    "zh": "发现与浏览",
    "en": "Discover & Browse"
  },
  "feat-discover-d": {
    "zh": "按关键词搜索技能，或输入 GitHub 仓库链接直接浏览。精选仓库、推荐列表与最近访问，帮你找到需要的 Skill。",
    "en": "Search skills by keyword or open a GitHub repository URL. Curated repos, recommendations, and recent visits help you find the skills you need."
  },
  "feat-install": {
    "zh": "仓库详情与安装",
    "en": "Repo Details & Install"
  },
  "feat-install-d": {
    "zh": "安装前预览 SKILL.md，批量选择技能与目标编程工具。下载缓存减少重复等待，已安装状态与名称冲突清晰可见。",
    "en": "Preview SKILL.md before installing, then select skills and target coding agents in batches. Download caching saves repeat waits; installed skills and name conflicts are clearly marked."
  },
  "feat-local": {
    "zh": "本地 Skill 管理",
    "en": "Local Skill Management"
  },
  "feat-local-d": {
    "zh": "统一管理已安装技能与外部导入目录，支持收藏、归档、批量操作和一致性审计。按编程工具或仓库筛选，切换网格与列表视图。",
    "en": "Manage installed skills and imported folders together, with favorites, archives, batch actions, and consistency checks. Filter by coding agent or repository and switch between grid and list views."
  },
  "feat-editor": {
    "zh": "Skill 编辑器",
    "en": "Skill Editor"
  },
  "feat-editor-d": {
    "zh": "预览、编辑、分屏三种模式，边改边看 Markdown 效果。通过侧边文件树浏览和编辑辅助文件，切换或关闭前提醒保存未提交的修改。",
    "en": "Preview, edit, or use split view to see Markdown changes as you type. Browse and edit supporting files in the sidebar tree, with unsaved-change prompts before switching or closing."
  },
  "feat-create": {
    "zh": "Skill 创建",
    "en": "Skill Creation"
  },
  "feat-create-d": {
    "zh": "从零创建新 Skill，分屏实时预览编辑效果。自动写入 SSOT 目录并为选中编程工具创建符号链接。",
    "en": "Create new skills from scratch with live split-pane preview. Auto-writes to SSOT directory and creates symlinks for selected coding agents."
  },
  "feat-settings": {
    "zh": "全局设置",
    "en": "Global Settings"
  },
  "feat-settings-d": {
    "zh": "管理主题、语言、内置与自定义编程工具。更新管理器集中检查和更新技能；可选 GitHub Token 提高 API 配额，减少仓库信息读取受限。",
    "en": "Manage themes, languages, and built-in or custom coding agents. Check and apply skill updates in one manager. An optional GitHub token raises API limits for more reliable repository information."
  },
  "design-eyebrow": {
    "zh": "设计哲学",
    "en": "Design Philosophy"
  },
  "design-title": {
    "zh": "核心产品设计决策",
    "en": "Core Design Decisions"
  },
  "design-lead": {
    "zh": "三项核心原则定义了 Skill Zoo 的架构方向与实现边界。",
    "en": "Three core principles define Skill Zoo's architectural direction and implementation boundaries."
  },
  "d1-title": {
    "zh": "文件系统是唯一的真实来源",
    "en": "Filesystem is the single source of truth"
  },
  "d1-desc": {
    "zh": "缓存从文件系统重建，而非反过来。用户拖入文件夹即发现，rm 即感知。notify crate 实时监听变化，1.5 秒防抖后自动重建缓存并推送事件至前端。",
    "en": "Cache is rebuilt from filesystem, not the other way around. Drag in a folder to discover, rm to remove. The notify crate watches for changes, rebuilds cache after 1.5s debounce, and pushes events to the frontend."
  },
  "d2-title": {
    "zh": "SSOT + 符号链接架构",
    "en": "SSOT + Symlink Architecture"
  },
  "d2-desc": {
    "zh": "~/.agents/skills/ 为规范存储。编程工具目录仅含符号链接，永不存放副本。远程安装复制至 SSOT 后链接；用户本地 Skill 保留原位不动，防止副本漂移。",
    "en": "~/.agents/skills/ is the canonical store. Coding agent directories contain only symlinks, never copies. Remote installs copy to SSOT then link; local skills stay in place, preventing copy drift."
  },
  "d3-title": {
    "zh": "Tauri IPC 是唯一桥梁",
    "en": "Tauri IPC is the only bridge"
  },
  "d3-desc": {
    "zh": "前端零文件系统访问、零 GitHub API 调用、零 git 执行。所有外部交互通过类型化 Rust Tauri 命令完成。路径遍历严格验证，拒绝绝对路径与父目录引用。",
    "en": "Zero filesystem access, zero GitHub API calls, zero git execution from the frontend. All external interaction goes through typed Rust Tauri commands. Path traversal is strictly validated — absolute paths and parent directory references are rejected."
  },
  "ux-eyebrow": {
    "zh": "用户体验",
    "en": "User Experience"
  },
  "ux-title": {
    "zh": "用户体验优化",
    "en": "UX Optimizations"
  },
  "ux-lead": {
    "zh": "从乐观更新到骨架屏，从 3D 动画到错误恢复，每个细节都经过精心设计。",
    "en": "From optimistic updates to skeleton screens, from 3D animations to error recovery — every detail is carefully crafted."
  },
  "ux-opt-title": {
    "zh": "乐观更新三阶段",
    "en": "Optimistic Update — Three Stages"
  },
  "ux-opt-desc": {
    "zh": "以收藏为例：点击星标瞬间 UI 已更新，API 在后台发出。请求失败则快照回滚，用户看到的始终是正确状态。mutation 错误由 sonner toast 短暂弹出，不打断当前操作。",
    "en": "Example with favorites: UI updates instantly on star click, API fires in background. On failure, snapshot rollback ensures users always see the correct state. Mutation errors briefly surface via sonner toast without interrupting workflow."
  },
  "ux-cache-title": {
    "zh": "多级缓存策略",
    "en": "Multi-level Caching"
  },
  "ux-cache-desc": {
    "zh": "ZIP 24h TTL、SHA-256 按 mtime 缓存、React Query staleTime/gcTime，层层减少不必要网络请求。",
    "en": "ZIP 24h TTL, SHA-256 cache by mtime, React Query staleTime/gcTime — layers of caching to reduce unnecessary network requests."
  },
  "ux-skeleton-title": {
    "zh": "精确骨架屏",
    "en": "Precise Skeleton Screens"
  },
  "ux-skeleton-desc": {
    "zh": "骨架屏精确镜像真实布局：侧边栏 4 行变宽占位 + 6 个卡片，而非粗糙的全局 spinner。Hero 区域独立骨架屏防止布局偏移。",
    "en": "Skeleton screens mirror the exact layout: sidebar with 4 staggered rows + 6 cards, not a crude global spinner. Independent hero skeleton prevents layout shift."
  },
  "ux-sync-title": {
    "zh": "文件系统实时同步",
    "en": "Real-time FS Sync"
  },
  "ux-sync-desc": {
    "zh": "后端 notify crate 监听文件变化，1.5s 防抖后推送 events。用户在终端修改 Skill 文件后无需手动刷新。",
    "en": "Backend notify crate watches file changes, pushes events after 1.5s debounce. No manual refresh needed after editing skill files in the terminal."
  },
  "ux-min-title": {
    "zh": "最低可见时长",
    "en": "Minimum Visible Duration"
  },
  "ux-min-desc": {
    "zh": "即使重新扫描只需 200ms，加载状态也会持续至少 800ms，避免一闪而过，让每次操作都感觉真实可靠。",
    "en": "Even when rescan takes only 200ms, loading state persists for at least 800ms to avoid flickers, making every operation feel tangible."
  },
  "agents-eyebrow": {
    "zh": "生态",
    "en": "Ecosystem"
  },
  "agents-title": {
    "zh": "覆盖主流 Coding Agent",
    "en": "Across Major Coding Agents"
  },
  "agents-lead": {
    "zh": "从 CLI 到 IDE，从终端到桌面，覆盖主流 AI 编程工具。",
    "en": "From CLI to IDE, terminal to desktop — across the full spectrum of AI coding tools."
  },
  "overview-eyebrow": {
    "zh": "产品概览 · 2026",
    "en": "Product Overview · 2026"
  },
  "overview-lead": {
    "zh": "为 AI 编程助手打造的 Skill 桌面管理工具，覆盖发现、安装、编辑到维护的完整工作流。基于 Tauri v2 构建，轻量、离线、安全。",
    "en": "Desktop skill manager for AI coding assistants, covering the full workflow from discovery and installation to editing and maintenance. Built on Tauri v2 — lightweight, offline, and secure."
  },
  "dl-download": {
    "zh": "下载",
    "en": "Download"
  },
  "dl-source": {
    "zh": "查看源码",
    "en": "View Source"
  },
  "install-title": {
    "zh": "安装 Skill Zoo",
    "en": "Installing Skill Zoo"
  },
  "install-os-macos": {
    "zh": "macOS",
    "en": "macOS"
  },
  "install-os-windows": {
    "zh": "Windows",
    "en": "Windows"
  },
  "install-os-linux": {
    "zh": "Linux",
    "en": "Linux"
  },
  "install-retry": {
    "zh": "下载未开始？",
    "en": "Download didn't start?"
  },
  "install-manual-click": {
    "zh": "点此手动下载",
    "en": "Click here"
  },
  "install-all-releases": {
    "zh": "在 GitHub 查看所有版本",
    "en": "View all releases on GitHub"
  },
  "install-mac-step1": {
    "zh": "确认系统为 macOS 13.3 或更新版本，打开下载的 <code>.dmg</code> 文件",
    "en": "On macOS 13.3 or later, open the downloaded <code>.dmg</code> file"
  },
  "install-mac-step2": {
    "zh": "将 <strong>Skill Zoo</strong> 拖入 <code>Applications</code> 文件夹",
    "en": "Drag <strong>Skill Zoo</strong> into the <code>Applications</code> folder"
  },
  "install-mac-step3": {
    "zh": "首次打开：若提示「无法验证开发者」，请在 Finder 中右键 (或 Ctrl-单击) 选择<strong>打开</strong>，然后再次点击打开",
    "en": "First launch: if you see \"unidentified developer\", <strong>right-click</strong> (or Ctrl-click) the app in Finder, select <strong>Open</strong>, then click Open again"
  },
  "install-mac-alt-title": {
    "zh": "或通过 Homebrew 安装",
    "en": "Or install via Homebrew"
  },
  "install-win-step1": {
    "zh": "运行下载的 <code>.exe</code> 安装程序",
    "en": "Run the downloaded <code>.exe</code> installer"
  },
  "install-win-step2": {
    "zh": "按安装向导完成安装",
    "en": "Follow the installation wizard"
  },
  "install-win-step3": {
    "zh": "若 SmartScreen 警告，点击「更多信息」→「仍要运行」",
    "en": "If SmartScreen warns, click <strong>More info</strong> → <strong>Run anyway</strong>"
  },
  "install-win-alt-title": {
    "zh": "或使用便携版",
    "en": "Or use the portable version"
  },
  "install-win-alt-desc": {
    "zh": "下载便携版 .zip，解压到任意文件夹，双击 <code>skill-zoo.exe</code> 即可运行，无需安装。",
    "en": "Download the portable .zip, extract anywhere, and run <code>skill-zoo.exe</code> — no installation needed."
  },
  "install-linux-step1": {
    "zh": "下载与你 CPU 架构匹配的 <code>AppImage</code> 文件",
    "en": "Download the <code>AppImage</code> file for your CPU architecture"
  },
  "install-linux-step2": {
    "zh": "运行 <code>chmod +x Skill-Zoo-*-Linux-*.AppImage</code> 添加可执行权限",
    "en": "Run <code>chmod +x Skill-Zoo-*-Linux-*.AppImage</code> to make it executable"
  },
  "install-linux-step3": {
    "zh": "双击 AppImage，或在终端中执行它",
    "en": "Double-click the AppImage, or run it from your terminal"
  },
  "install-linux-alt-title": {
    "zh": "Linux 下载选项",
    "en": "Linux download options"
  },
  "install-linux-alt-desc": {
    "zh": "提供 x86_64 和 ARM64 AppImage；Debian 系发行版也可安装对应的 .deb 包。",
    "en": "x86_64 and ARM64 AppImages are available. Debian-based distributions can alternatively install the matching .deb package."
  },
  "cta-title": {
    "zh": "准备好整理你的技能库了吗？",
    "en": "Ready to organize your skill library?"
  },
  "cta-desc": {
    "zh": "支持 Claude Code、Codex、Cursor、OpenCode 等 20 多款编程工具，也可添加自定义工具。通过桌面 App、npm CLI 或本地 Web UI，管理同一份技能文件。",
    "en": "Supports 20+ coding agents including Claude Code, Codex, Cursor, and OpenCode, plus custom agents. Manage the same skill files through the desktop app, npm CLI, or local Web UI."
  },
  "meta-title": {
    "zh": "Skill Zoo · 产品概览",
    "en": "Skill Zoo · Product Overview"
  },
  "meta-description": {
    "zh": "发现、安装、编辑和维护 AI 编程助手的 Skill。Skill Zoo 支持 20 多款编程工具，提供本地技能管理、归档与更新。",
    "en": "Discover, install, edit, and maintain skills for 20+ AI coding agents. Skill Zoo brings local skill management, archives, and updates to your desktop."
  }
} as const;

export type UiKey = keyof typeof messages;

export function useTranslations(lang: Lang) {
  return (key: UiKey): string => messages[key][lang];
}

export function langPath(lang: Lang) {
  return basePath + (lang === 'zh' ? 'zh/' : '');
}
