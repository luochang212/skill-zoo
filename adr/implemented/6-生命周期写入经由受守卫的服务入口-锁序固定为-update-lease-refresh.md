---
status: implemented
date: 2026-11-08
description: 在新增或改动技能生命周期写入（安装、更新、归档、恢复、合并、导入）或其锁使用之前阅读；生命周期操作必须经持守卫的服务入口，锁序固定为 update、lease、refresh，无锁签名只许存在于测试构建。
raised-by: agent
decided-by: agent
created: 2026-11-08
paths:
  - src-tauri/src/store.rs
  - src-tauri/src/services/skill_archive.rs
  - src-tauri/src/services/skill/merge.rs
  - src-tauri/src/commands/skill.rs
---

# ADR: 6 生命周期写入经由受守卫的服务入口：锁序固定为 update、lease、refresh

## Problem

一次技能生命周期操作要按正确顺序安排六类副作用：实体目录、agent 链接、manifest、lock、用户元数据、缓存；失败时还要按相反顺序回滚。此前这个顺序是每个入口自己记一遍：归档/恢复在 IPC 文件里手写回滚闭包，合并是另一套独立的提交规则，导入维护三套回滚记账。重复记忆已经被复现的缺陷证伪——阻塞 `skills-cache.json.tmp` 后，合并返回失败但 agent 原目录已被删除替换成链接；归档的回滚则在持有状态写锁时重取锁而挂起。

## Decision

每个生命周期写入在 services 层有一个受守卫的生产入口，按固定顺序获取三重守卫：update-exit 保护（`state.update_exit.start_update()`）、跨进程本地租约（`state.acquire_local_lease()`，见 `src-tauri/src/store.rs` 的实现：取锁前重载 metadata 以与 CLI 并发写共存）、刷新互斥锁（`state.cache_refresh_lock`）。守卫对象同时拥有缓存与元数据的写入和快照恢复（如 `skill_archive.rs` 的 `ArchiveWrite`、`services/skill/merge.rs` 的 `merge_duplicates`）。无守卫的裸签名只允许存在于 `#[cfg(any(test, feature = "test-helpers"))]` 构建；IPC 命令只做委托。失败恢复采用操作前完整快照（缓存、元数据、imports 注册表、lock），恢复不完整必须明示并保留备份位置；不新增崩溃/断电原子性承诺。

## Alternatives considered

- **通用事务执行器 / 扩展 agent-lifecycle journal 覆盖技能目录移动**：journal 只覆盖允许快照的状态文件，不含任意目录移动、lock 或 manifest；崩溃恢复是需要独立定义每步恢复结果的排队设计（2026-10-24 triage 已排队），不能靠改名现有 journal 冒充。
- **只把函数搬到 services、不引入写入上下文**：调用方仍能绕过共同规则，约束只是换了文件而没有减少需要记住它的地方——这正是要消除的问题。
- **按入口维护回滚记账**（导入旧的 new-IDs + updated-clones 两套机制）：比整份注册表快照更复杂且更易漏接，已被快照方案取代。

## Consequences

新增生命周期操作只需遵循一个模式，正确性规则的 Owner 从"N 个调用点"收敛为"一个受守卫入口 + 规格文本"（skill-archiving、skill-merging、local-protocol 已固化锁协调与回滚要求）。代价：守卫顺序靠隐私性与规格、测试约束，而非编译器——顺序错误的调用方仍可编译，绕过靠模块隐私阻断；测试专用的无锁签名一旦泄漏回生产构建即失去这层保障。快照克隆在大缓存下有内存成本，属已接受的权衡。
