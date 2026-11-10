# AGENTS.md

## 工作方式

**权衡收益与副作用。** 做选择时，考虑收益是否大于副作用。

**美学与优雅很重要。** 美是一种生产力。

**从第一性原理推理。** 把问题剥离到可验证的事实，再向上推理。"大家都是这么做的"不是事实。

**先想后写。** 说出你的假设。摆明权衡。若存在多种解读，全部列出，不要默默挑一个。有不清楚的地方就停下来问。任何改动前先问：这会引入 bug 吗？是否比需要的更复杂？收益是否大于副作用？

**用最少的代码解决问题。** 不加没人要的功能。不为单次使用的路径建抽象。不为不可能发生的场景写错误处理。不加没人要求的"可配置性"。每一层额外的分层、依赖或间接都必须物有所值。用更少的代码表达更多，才叫酷。

**不允许注释。** 用更精确的文件、函数命名，以及反错误模式的测试代替注释。

**只动必须动的。** 不重构相邻代码。不修不是你弄坏的格式。匹配现有风格，哪怕你会用别的写法。只移除因你的改动而不再使用的 import。

**一致性是承重的。** 假设不同现实的各层能通过局部检查，却在全局失败。上层结构未定型就移动地基，不会带来迭代能力，只会注定腐烂。当一个设计决策改变时，找出所有依赖旧决策的地方。陈旧代码是尚未发作的 bug。

**宣称完成前先验证。** 没跑过就不要说跑过了。无法验证时，如实说明。

**不擅自 commit。** 未经用户明确允许，不得执行 git commit。

**优先选最新稳定版。** 选择依赖版本时，用最新稳定发布版。

**除非非用不可，开发尽量不走 Docker。** 反复构建镜像耗时太长。

**识别局部最优。** 当一系列增量修改表明更广的重构会带来更好的结果时，停下来问用户再继续。

## 分支权威性

`main` 是权威开发主线；CI 在每次向它 push 和 PR 时运行。`next/own-protocol` 已 fast-forward 回 `main`。`next/curated` 是 0.3.56 兼容性实验（本地 tag `v0.3.56-beta.4`），`next/verified-baselines` 是冻结的 0.3.56 预发布实验；两者均仅作参考。

## 这个项目是什么

一个用于管理 AI 编程助手 Skills 的桌面应用。用户可以跨多个 agent（Claude Code、Codex、Gemini、Cursor 等）浏览、安装、创建和管理 Skill 文件。

核心洞察：Skill 就是文件。本应用本质上是一个带专用 UI 的文件管理器。

## 项目布局

- **桌面应用**位于 `src-tauri/`
- **CLI** 位于 `packages/cli/`
- **项目网站**位于 `site/`（独立的静态 Astro 构建；见 `site/README.md`）

## 核心设计决策

### 文件系统是事实来源

Skill 以普通文件的形式存在于磁盘上。缓存不是事实来源，文件系统才是。缓存从文件系统状态重建，陈旧条目在重建时清理。用户元数据（收藏、"我的 skills"）在重建间保留。

这意味着：用户把 skill 文件夹放进正确的目录，应用就会发现它；用户 `rm` 掉一个，应用就会察觉。应用反映现实，而不是反过来。

### SSOT + 符号链接

`~/.agents/skills/` 是已安装与用户自建 skill 的规范存储。agent 目录中只包含指向真实位置的**符号链接（symlink）**。

来源有两种，符号链接的目标取决于来源：

- **远程安装**（来自 GitHub）：下载 ZIP → 解压到临时目录 → 文件**复制**进 `~/.agents/skills/<name>/` → 各 agent 目录符号链接到 SSOT。这里必须复制，因为临时目录是临时的，没有可链接的稳定来源。
- **用户本地 skill**（已在某个 agent 目录里，如 `~/.hermes/skills/`）：skill 留在原地。**绝不复制或移动它。** 其他 agent 目录直接符号链接到原始位置。应用通过扫描所有 agent 目录并使用 `detect_home_path`（跳过符号链接以找到真实目录）来发现这些 skill。

两种情况下，agent 目录永远只包含符号链接，绝不包含副本。区别只在符号链接指向哪里：远程安装指向 SSOT，本地 skill 指向用户自己的目录。

这个设计尊重用户的文件，避免产生分叉的副本。如果 skill 被复制而非链接，副本会悄悄偏离原件——用户编辑一个版本，另一个版本变成陈旧的。每个 skill 只有一个事实来源（无论在 SSOT 还是在用户自己的目录），就能避免这种情况。

### 本地可见性与冲突范围

桌面应用广泛扫描文件系统事实，但面向用户的本地视图和安装冲突检查使用更窄的**可见本地范围（visible local scope）**：

- 始终包含 `~/.agents/skills/` 中的 SSOT skill。
- 真实 `origin=agent` skill 目录仅在其 `homeAgent` 当前于设置中可见时才纳入。
- `origin=external` 导入作为管理对象保持可见，即使未链接到任何 agent。在本地页列表中，它们与其他非 SSOT skill 一样遵循非 SSOT 可见性开关；设置中的导入管理器则无视该开关，始终列出它们。
- 同名冲突/重复一致性检查不纳入隐藏 agent 的 skill 或外部导入。
- `origin=plugin` skill 不参与冲突/重复一致性检查；它们是只读发现，永远不会是安装/链接目标。
- Discover/仓库安装冲突检查必须使用相同范围：SSOT 加可见 agent 的真实目录，排除外部导入。
- 安装预检必须检查 SSOT 加该次安装操作所选的 agent 目录，而不是所有可见或已知的 agent 目录。

这防止隐藏 agent 或外部导入记录制造用户在本地页上找不到的冲突，同时保留外部导入作为可管理条目。

### 本地协议护栏

桌面应用拥有 Skill Zoo 的本地协议。CLI 是附属控制面，必须遵从桌面拥有的本地状态；不得为自身方便定义独立 schema 或更改协议 fixtures。

影响协议的工作包括：更改桌面拥有的本地状态结构、路径、schema 版本、lock/archive 写语义，或用户可见的兼容性与迁移行为。此类工作是有意为之时，需在同一次改动中更新本地协议文档、桌面协议 fixtures，以及 CLI 与 Rust 双方的协议测试。

`fixtures/local-protocol/` 下的 fixtures 代表桌面应用当前协议。若 CLI fixture 测试失败，修复 CLI 以遵从桌面协议，除非桌面协议本身有意更改。

### 与外部 skill 管理器的兼容性

`CliService` 是我们所需安装/更新行为的原生实现。我们不追求与 `npx skill` 或 `gh skill` 的协议兼容；它们的 schema 与语义是想法来源，不是契约。能改进产品的能力就借鉴；不镜像上游变更，也不加仅为兼容而存在的分支。见 ADR 1。

### Tauri IPC 是唯一桥梁

前端绝不触碰文件系统、绝不调用 GitHub、绝不运行 git。所有外部交互都经过有类型的 Rust Tauri commands。这是安全边界。

### TanStack React Query 管理服务端状态

后端数据经由 hooks 流动。Mutation 使依赖的 query 失效。组件局部状态只用于 UI 事务（对话框开没开？哪个 tab 激活？）。

### 浏览器支持基线

前端发布在三个引擎上（macOS 用 WKWebView，Windows 用 WebView2，Linux 用 WebKitGTK），所以"Baseline widely available"不是标准。标准是 **Safari 16.4 / macOS 13.3**——恰好是 Baseline Widely Available 的 Safari 边界，也是 Tailwind v4 的文档基线。

这条基线有两个机器可读的归宿，每个维度一个：浏览器引擎在 `vite.config.ts` 的 `build.target`（显式固定为 `safari16.4`），OS 版本在 `src-tauri/tauri.conf.json` 的 `bundle.macOS.minimumSystemVersion`。文字描述不得与两者矛盾。

每个平台特性属于两类之一。**承重（load-bearing）**特性是应用缺了它就坏的特性，必须特性检测或提供回退。**渐进（progressive）**特性是缺了只会降级不会崩溃的特性（主题切换的 view transition 和 `::-webkit-scrollbar` 颜色回退都是渐进的）。不在同一次改动中抬高基线，就不要添加高于基线的承重特性。

## 架构决策

本仓库用 `adr-kit` 维护架构级决策（全局 CLI，非本仓库依赖；配套 skills 在 `.agents/`）；记录位于 `adr/`。用 `adrkit list` 浏览，`adrkit show <N>` 阅读单条，`adrkit relevant <path>` 查找与某文件相关的记录。记录有成本：每条记录都是代码之外的第二个事实来源，需要维护。但也是必需的——代码只是根因产生的症状，根因不留记录，未来的 agent 就只能从代码里反向猜测。只有重大决策才值得记 ADR，常规修改属于 Git 和测试；准入条件以 `adrkit-propose` 与 `adrkit-record` skills 载的四问记录测试为准。

## 测试

**运行测试：**
- 前端：`bun run test`
- 后端：`cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`
- CLI：`bun run cli:test`（vitest）。不要在 `packages/cli` 里跑 `bun test` —— Bun 会把测试的 `vitest` 导入别名为 `bun:test`，在该别名下 `tests/imports.test.ts` 中的符号链接重导入测试至少会挂起，直到 runner 超时杀掉它。

**在 bug 滋生处测试，无关的跳过。** 只测试既会出错、出错又会造成伤害的代码。不测薄封装、平凡 getter、库行为、简单 useState。这些不会坏；就算坏了也一眼可见。

**对复杂代码用简单方法。** 优先"输入 → 断言输出"，而非重型基础设施。

**测试与代码同步。** 同一次改动中写或更新测试，不要攒到以后。

**测试文件就地共存。** `*.test.ts` 放在被测模块旁边（如 `src/hooks/useSkills.test.ts` 与 `src/hooks/useSkills.ts` 并排）。

## 代码质量

**Lint：** `bun run lint`（oxlint，correctness、suspicious、perf 规则）
**Format：** `bun run format`（oxfmt）
**CI 门禁：** 每个 PR 跑 lint、typecheck、format 检查和测试。`adrkit validate --all` 经 `.githooks/pre-push` 运行，因为 CI 不覆盖 `adr/`。

## 开发服务器

前端开发服务器在 Bun 下运行（`bun run dev` → `bunx --bun vite`）。Vite 把预打包的依赖缓存在 `node_modules/.vite`。

当 `package.json` 变化（增删依赖，或运行 `bun install` / `bun remove`）时，该缓存可能过期。典型症状是 `[vite:import-analysis] Failed to resolve import "<dep>"`，而该依赖明明装在 `node_modules` 里。清缓存并重启：

    rm -rf node_modules/.vite && bun run dev

或者用 `bunx --bun vite --force` 强制一次性重新打包。注意 `bun install` 只修复 `node_modules`，不碰 Vite 缓存，且运行中的 dev server 在内存里持有过期的优化器状态，所以必须完整重启。

## 项目网站

`site/` 承载公开落地页。独立构建它：`npm --prefix site ci`、`npm --prefix site run check`、`npm --prefix site run build`；浏览器回归测试在安装 Playwright Chromium 后用 `npm --prefix site test`。桌面/CLI 构建不覆盖它。

同一次改动中同时编辑 `site/src/i18n/ui.ts` 的两种语言。保留 `/skill-zoo/` 部署 base、`/zh/` 路由、旧 `?lang=zh/en` 链接，以及 `site/public/version.json` 作为已发布版本来源。发布自动化更新该 manifest；不要用开发包版本替代。网站部署是 `.github/workflows/site.yml`；资源放在 `site/public/`，无关文档留在 `docs/`。
