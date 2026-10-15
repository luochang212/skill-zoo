# Proposal

## Why

`~/.agents/.skill-lock.json` v3 是本方、`npx skills` 与 `gh skill`（cli/cli，v2.90.0+，开源、public preview）共写的生态互操作面。两轮独立评审（2026-10-15：源码级分析 + 对上游真实锁函数与 vercel 1.5.3/1.7.2 发布包的运行时探针，见 [evidence/](evidence/)）证实：

- gh 的锁写入是整文件读改写，其 Go 结构体不含本方 `ref`/`commitSha`：**无关条目**的这两个字段在 gh 任何一次写锁（install/update 触发 `RecordInstall`）时被剥掉（实测复现）；**同名条目**被整体重建，来源、hash、pin 全部替换。v2.102.0 源码无 dismiss 写锁路径。
- 更新检查在基线 `commitSha` 缺失时静默按「无更新」处理（`settings.rs` 的 `_ => false` 分支），并把远端 latest 自动补写为基线（`settings.rs` "save the latest SHA now" 分支）——待更新被掩盖，持续到远端再次变化或记录重建，而非永久不可见。
- 本方 Rust 重写会丢弃外部扩展字段（如 `pinnedRef`；已用生产类型探针实测）。
- `commitSha` 的实际语义是技能子树 git tree SHA（字段名有误导）；共享 schema 中已有同语义字段 `skillFolderHash`，gh 对无关条目无损保留它，vercel 更新路径消费它（40 位 hex 按 git tree hash 比较）。

这是静默元数据损坏：高频触发（任何 gh 写锁、无需同名或并发）、自我伪装（显示为「无更新」）。合法 v3 文件中字段被剥没有版本信号，既有「拒绝更高版本」的版本门对此不设防。

## What Changes

- **基线载体对齐共享 schema**：安装/更新把子树 tree SHA 同时写入 `skillFolderHash`（权威载体）与 `commitSha`（兼容镜像）；更新检查按 `docs/local-protocol.md` 定义的读序取基线。值的语义由 git 对象模型定义，不依赖 gh 存在与否。
- **双端未知字段无损往返**：桌面 Rust 侧保留本方未声明的条目级与顶层字段（companion CLI 已天然保留，以回归测试固化）。
- **缺失/冲突基线的显式状态**：无任何可信基线的条目呈现 needs-re-confirmation 状态（不再静默「无更新」）；远端 latest 仅在「从未记录过基线」时自动补写（保持现有降级安装的一周期设计）；两载体值冲突 → 显式状态，不静默择一。
- **外部 pin 闸门**：含 `pinnedRef` 的条目被更新流跳过并显式报告，字段不被本方改写。
- **协议载体同步**：按 Local Protocol Guardrails 更新 `docs/local-protocol.md`（字段语义、读序、自动补基线规则、`commitSha` 命名勘误）、`fixtures/local-protocol/` 与 Rust/CLI 双端测试。
- **明确不做（本期）**：来源归属（同名接管）检测——git tree SHA 在对象模型上不含来源身份（不同仓库的相同子树哈希相同；本方复制管线自身也会改变树哈希），且无独立可信记录时无法区分「剥离」与「接管」。该项收缩为二期选项（私有记录方向，触发条件见 design 的 watch 清单），本期 spec 不承诺。显式 `ref` 丢失遵循既有文档语义（回落默认分支），是接受信息丢失，不包装成恢复。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-protocol`: 新增共享锁外部共写兼容性需求——未声明字段的无损往返、基线读序与缺失基线显式状态、冲突/不完整溯源显式化、外部 pin 闸门。

## Impact

- **代码**：`src-tauri/src/services/lock.rs`（pinnedRef 字段 + flatten 无损往返）、安装/更新写入点（`services/cli.rs`、`commands/skill.rs`、`services/skill.rs`）、`commands/settings.rs`（基线读序与检查语义）、前端更新状态消费（`src/components/settings/` 与 IPC 类型）。
- **TS CLI**：无行为改动，回归测试固化既有无损行为。
- **协议**：`docs/local-protocol.md`、`fixtures/local-protocol/`（gh 形态往返、双载体冲突、pin 条目样例）。
- **依赖**：无新增；锁 schema 仍为 v3（字段级演进，不触发版本门）。
- **证据**：两轮评审报告与全部实验探针见 [evidence/](evidence/)（gh `RecordInstall` 探针、vercel 1.5.3/1.7.2 发布包函数探针、树哈希保真度实验）。
- **验证边界**：真实远程安装端到端、Windows 运行时、桌面全流程未实测，由实施期回归测试与手工冒烟承接。
