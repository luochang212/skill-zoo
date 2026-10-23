# claude-skill-manager / csm（★1|Python|2026-05-18|MIT）

## 1. 定位与架构（实证）

一句话定位：把用户自组织的技能库（sources）以软链接形式「扁平部署」进各项目的 `.claude/skills/`（targets），并让 LLM agent 能自助使用它。

- 技术栈：Python + Typer + Textual（TUI），uv/pip/Homebrew 分发，16 个测试文件覆盖核心模块。
- SSOT/分发模型：**多 source 可配置**（`csm.toml` 的 `source_paths` glob），每个 target 的 `.claude/skills/` 只放 symlink 指回 source 原目录（`src/skill_manager/core/deployer.py:295-301` `symlink_to(item.path)`，绝对链接）。与 skill-zoo 的差异：没有全局唯一 SSOT，而是「用户声明的任意个库」；本地技能不复制、链接回原处，这一点与 skill-zoo 的 origin=agent 语义一致。
- 形态：CLI + TUI 双形态，CLI 为 agent 自动化设计。
- 技能来源：本地目录（glob 发现）+ Claude Code marketplace/plugin（`plugin:`/`mp:` 前缀命名空间，`core/inventory.py:5-6`）。
- 配置：`~/.config/claude-skill-manager/csm.toml`，glob 语义文档化极清晰（无 glob=目录本身是库；`a/*`=子目录是技能；`a/*/*`=两层深；README「Configuration」节）。

## 2. 功能清单

- [完整] `csm schema`：输出一份**手写 JSON 自描述文档**（tool/version/concepts/config/commands/diagnostics_types/tui_keybindings，`src/skill_manager/cli.py:670-795`），设计目标就是「`| head -c 4000` 注入 agent 系统提示词」，即 agent 无需读人类文档即可学会调用 CLI。README「Agent-Friendly by Design」节给出完整 bootstrap 序列。
- [完整] 全命令 `--json` + **错误永远为结构化 JSON**（stderr，`{error:{code,message,reason}}`，`cli.py:74-80`，仿 Google Workspace CLI）；JSON 模式无交互提示，可安全脚本化。
- [完整] `adopt` 孤儿收养：检测 target 内非 symlink 的裸技能目录 → `shutil.move` 进 source 库 → 原位补 symlink（`core/deployer.py:321-353`）。护栏齐全：user scope 由 Claude Code 托管禁止收养、拒绝 symlink 误认、目标重名即失败、`--dry-run`、省略 `--to` 时列出全部候选库（`cli.py:527-600`、`core/discovery.py:350-363`）。
- [完整] 诊断体系：按「同 target 内」判定冲突并分级。分级结果为 `user-user` ERROR / `user-plugin`、`orphan-plugin`、`cross-marketplace` WARNING / `scope-overlap`、`mp-cache` INFO(README「Diagnostics」节 + `core/conflicts.py`)。关键洞察：**重名只在同一 target 活跃时才是冲突**。
- [半成品] plugin 集成：能发现/安装 Claude Code plugin（外壳调 `claude plugin install`），`updates` 命令检测陈旧 plugin 缓存，但受制于上游 CLI 的黑盒行为。

## 3. 借鉴候选（90 分门槛）

### 3.1 `csm schema`（CLI 自描述 JSON 供注入 agent 上下文）
- 是什么：一条命令输出机器可读的完整工具契约（命令/概念/配置/错误格式），让 coding agent 零文档成本学会用 CLI。
- 程度：结构完整且与实现同步（commands 列表覆盖全部 12 条，含 examples 与 JSON 字段说明）；配 `--json` 全覆盖 + JSON-on-error 构成闭环协议，不是摆设。
- 为何 great：极简。一个手写 JSON 文件 + 一条命令就解决了「agent 如何学会用你」，无 MCP server、无 plugin 依赖，任何 agent 都能吃。这是「让 agent 学会用你」的最小充分协议。
- 落点：给 `packages/cli/` 增加 `skill-zoo schema` 子命令，输出含命令契约、本地协议概念（SSOT/origin/symlink 语义）、`--json` 字段与错误码的 JSON。代价小（纯 CLI 层，不动 Rust 协议）；需注意与「桌面拥有本地协议」的纪律一致，即 schema 内容应从协议文档生成或至少同 change 更新，避免第二份漂移真相。与 Tauri IPC 边界无冲突（CLI 本就是桌面协议的从属面）。

### 3.2 `adopt` 孤儿收养流程
- 是什么：把散落在 agent 目录里的裸技能目录移入技能库并原位补链。
- 程度：护栏完整（dry-run、user-scope 保护、重名失败、候选库列举），代码干净。
- 为何 great：它精确实现了 skill-zoo AGENTS.md 的「用户本地技能绝不复制、链接回原目录」原则的**反向操作**。发现不合规状态后一次交互把世界收敛回单源状态，而非复制出第二副本。
- 落点：skill-zoo 桌面端 Local 页对 `origin=agent` 真实目录已有发现能力；补一个「收养进 SSOT」动作（Rust 侧 rename 到 `~/.agents/skills/` + 原位 symlink 回指，CLI 侧同语义命令）。代价中；与 SSOT 模型零冲突，是模型的自然补全。注意点：跨卷 rename 失败需回退复制+删除。

## 4. 明确不借鉴（带理由）

- 多 source 配置模型（`csm.toml` glob）：skill-zoo 已裁定 `~/.agents/skills/` 为唯一 SSOT，多库制是它没有 SSOT 概念的代偿。
- 绝对路径 symlink（`symlink_to(item.path)`）：跨机器/跨用户迁移脆弱，我方应保持相对链接策略。
- target 自动发现（扫 `.claude/` 目录）：我方以 Settings 可见性为准，避免隐性扫描用户目录树。
- Textual TUI：非我方形态。
- plugin 集成外壳：绑定 Claude Code 单一上游，抽象不普适。

## 5. 借鉴裁定

ABSORB: `csm schema`（CLI 自描述 JSON，落点 `packages/cli/` 新子命令 + 本地协议文档同源更新）、`adopt` 孤儿收养（桌面 Local 页动作 + CLI 命令，rename→SSOT→symlink 回指，含 dry-run 与护栏）。

补充信号（不进 ABSORB）：其 per-target 冲突分级诊断（重名仅在同 target 活跃才算冲突）与我方「Local Visibility and Conflict Scope」决策高度互证，可在冲突检查实现时直接引用该分级词汇表。
