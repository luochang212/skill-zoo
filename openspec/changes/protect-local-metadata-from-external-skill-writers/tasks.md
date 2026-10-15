# Tasks

## 1. 协议载体（契约先行）

- [x] 1.1 `docs/local-protocol.md`：定义基线读序（`skillFolderHash` 权威 → `commitSha` 镜像回落 → 显式状态）、自动补基线规则（仅从未记录过基线时一次）、双载体冲突语义、`pinnedRef` 闸门；勘误 `commitSha` 命名（实际为子树 tree SHA）
- [x] 1.2 `fixtures/local-protocol/` 新增：gh 形态往返样例（含 `pinnedRef`、未知键、仅 `skillFolderHash` 的条目）、双载体冲突样例、pin 条目样例
- [x] 1.3 AGENTS.md：澄清「native Rust 重实现」指 `src-tauri` 的 `CliService`，`packages/cli` 是 TS companion CLI

## 2. Rust 锁层

- [x] 2.1 `services/lock.rs`：`SkillLockEntry` 增加类型化 `pinnedRef` + `#[serde(flatten)]` 未声明字段往返；`SkillLock` 顶层同样处理；提供「同时写两基线字段」的更新入口
- [x] 2.2 单测：未知条目级/顶层键与 `pinnedRef` 在 read-modify-write 后值不变；既有构造点补默认值

## 3. Rust 安装/更新写入点

- [x] 3.1 `services/cli.rs` 安装落锁路径：tree SHA 同时写入 `skillFolderHash` 与 `commitSha`
- [x] 3.2 `commands/skill.rs` / `services/skill.rs` 单技能与批量更新路径：基线回写同样双写；更新相等门改按读序取基线

## 4. Rust 更新检查语义

- [x] 4.1 `commands/settings.rs`：按读序取基线；无基线 → 显式 needs-re-confirmation 状态（不再静默「无更新」）；自动补基线仅限「从未记录过基线」；冲突 → 显式状态且不取更新
- [x] 4.2 含 `pinnedRef` 条目在检查与批量更新候选中跳过并显式报告；单技能更新拒绝并说明原因
- [x] 4.3 IPC 类型与命令输出暴露新状态变体

## 5. 前端消费

- [x] 5.1 更新状态类型与渲染：needs-re-confirmation / conflict / pinned-skip 沿用既有展示模式（en/zh 文案）
- [x] 5.2 批量更新的候选过滤与计数与新语义一致

## 6. TS CLI 回归

- [x] 6.1 `packages/cli` 测试：消费 1.2 fixtures 固化 `readLock`/`writeLock` 对未知键与 `pinnedRef` 的无损往返（无行为改动）

## 7. 验证

- [x] 7.1 回归：gh 形态 JSON 往返本方条目后未知字段不丢、基线读序生效、自动补基线只在「从未记录」分支发生
- [x] 7.2 `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`、`bun run test`、`packages/cli` 测试；`bun run lint`、`bun run format` 与 Rust format check
- [x] 7.3 `openspec validate --all --strict` 通过；核对 `local-protocol` 主 spec 合并一致性
- [x] 7.4 手工冒烟：模拟 gh 写锁（剥镜像字段 + pinnedRef 条目 + 双字段冲突）后，应用呈显式状态、不静默改写基线

## Workflow follow-up

- 归档前同步 `local-protocol` 主 spec（ADDED 需求并入）
- 向 cli/cli 提 issue：未声明字段有损往返 + 异常/未来版本文件整表重置风险（evidence/ 探针可直接引用）
- watch 触发器：gh/vercel 变更锁字段、版本或 unknown-field 行为 → 重跑隔离探针；真实用户报告同名接管 → 启动 B（私有记录方向）二期立项；Codex 移除 legacy 读取 → A1 重启（既有）
