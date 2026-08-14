# Design: fix-archive-rollback-lock-deadlock

## Context

`state.skill_cache` / `state.metadata` 是 `std::sync::RwLock`（store.rs:5-6），不可重入。三处失败路径在持有写锁的 guard 存活时调用 `rollback`，后者经 `restore_archive_stores`（commands/skill.rs:157）重新 `write()` 同一把锁 → 同线程永久阻塞。`archive_skills`/`restore_archived_skills` 为同步 tauri 命令，主线程死锁即 UI 冻结。

## Goals / Non-Goals

**Goals:**
- 三处失败路径的 rollback 调用移到锁作用域之外。
- 正常路径的锁获取时机与持有范围不变。

**Non-Goals:**
- 不改锁类型（如换 tokio::sync::RwLock 或可重入锁）——主线程同步命令 + 短临界区，std RwLock 合适，问题只在错误路径的调用顺序。
- 不改 `restore_archive_stores` 本身（其"获取锁 → 恢复快照 → save"是正确语义）。
- 不改 `map_err(|e| rollback(...))` 分支（锁获取失败时未持锁，本就安全）。

## Decisions

1. **失败处理移出锁作用域：** 将每个"持锁修改 + save"块改为在块内仅计算 `save()` 的 `Result`，块结束（guard 释放）后再处理失败：

   ```rust
   let save_result = {
       let mut cache = state.skill_cache.write().map_err(|e| rollback(...))?;
       cache.remove(&skill.id);
       cache.save()
   };
   if let Err(e) = save_result {
       return Err(rollback(e.to_string(), &removed_agents));
   }
   ```

   `?` 提前返回的分支（锁获取失败）不持锁，可直接调用 rollback，保持原样。此模式三处统一，可读性不降。

2. **锁内只做内存修改 + save 调用，不做事后处理**——这是最小改动，锁持有时间与修复前相同（save 本身仍在锁内，写盘时锁保护的是内存结构一致性；原本的设计就是如此，维持不变）。

## Risks / Trade-offs

- [重构遗漏某条失败路径] → 三处逐一对照 grep `\.save()|return Err\(rollback` 确认；全套测试保证正常路径不回归。
- [行为级回归测试不可行] → `SkillCache::save`/`MetadataStore::save`/`ArchiveManifest`/`SkillLock` 路径硬编码真实用户目录（`~/.skill-zoo`、`~/.agents/skills`），构造 save 失败会污染真实环境。验证 = 结构审查 + 全套测试。此约束已记录于 proposal Impact。

## Migration Plan

无数据迁移。回滚即 revert。
