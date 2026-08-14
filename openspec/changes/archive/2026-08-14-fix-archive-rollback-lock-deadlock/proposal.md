# Proposal: fix-archive-rollback-lock-deadlock

## Why

归档（`archive_skill_inner`）与恢复（`restore_archived_skill_inner`）在缓存/元数据写入失败的回滚路径上存在死锁：失败发生时仍持有 `state.skill_cache` 或 `state.metadata` 的写锁，而 `rollback` 闭包调用的 `restore_archive_stores` 会再次获取同一把锁。`std::sync::RwLock`（store.rs:5-6）不可重入，同线程二次写锁永久阻塞。

已逐行核实的三条路径（commands/skill.rs）：

- 归档 cache 分支（1687-1689）：`cache.save()` 失败 → `return Err(rollback(...))` 时 `cache` guard 在作用域内 → `restore_archive_stores` 的 `state.skill_cache.write()` 死锁。
- 归档 metadata 分支（1698-1700）：`metadata.save()` 失败 → 同上，死锁在 `state.metadata.write()`。
- 恢复 metadata 分支（1916-1918）：`metadata.save()` 失败 → 同上。

`map_err(|e| rollback(...))` 的两处（锁获取失败分支）**未持锁**，安全，不在本次修复范围。`archive_skills`/`restore_archived_skills` 是同步 tauri 命令，Tauri v2 下跑在主线程——死锁即整个 UI 冻结、IPC 永不返回。

触发条件：`save()` 返回错误（磁盘满、目录只读、Windows 文件被占用），罕见但真实存在。

## What Changes

- 将三处"持锁修改 + save + 失败即 rollback"重构为"先在锁作用域内计算保存结果，guard 释放后再调用 rollback"。锁持有时间不变，仅失败处理移到锁外。
- 行为无变化：正常路径与失败路径的结果与错误信息保持一致。

## Capabilities

### New Capabilities

- `skill-archiving`: 归档与恢复技能的失败回滚必须能够在任何错误路径上完成，包括缓存/元数据持久化失败。

### Modified Capabilities

（无——`openspec/specs/` 目前仅 `skill-installation`，本次不涉及。）

## Impact

- 代码：`src-tauri/src/commands/skill.rs` 三处锁作用域。
- 验证约束（如实记录）：`SkillCache::save`/`MetadataStore::save` 的路径硬编码为 `~/.skill-zoo/skills-cache.json` 等真实用户路径，`ArchiveManifest`/`SkillLock` 亦同——行为级回归测试（构造 save 失败）会污染真实用户目录，不可执行。验证方式：结构修复 + 全套后端测试无回归 + 代码审查。
