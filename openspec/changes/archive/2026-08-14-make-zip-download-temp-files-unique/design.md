# Design: make-zip-download-temp-files-unique

## Context

`ensure_cached_zip_with_progress` 用固定名 `.tmp` 文件下载，`File::create` 的 O_TRUNC 使并发写入互相截断。完成后 `drop(file)` + `rename` 到固定缓存路径（`cache_zip_path`）。缓存文件本身是"同 key 幂等"的：同一 owner/repo/branch 的下载内容一致，后 rename 者胜出无害。

## Goals / Non-Goals

**Goals:**
- 每次下载的临时文件唯一，并发互不干扰。
- 保持"完成后 rename 到固定缓存路径"不变（缓存命中逻辑、force 语义不动）。

**Non-Goals:**
- 不做下载去重/互斥（并发下载同一仓库是低概率事件，重复下载只浪费带宽，无害）。若将来需要，是独立的缓存锁设计，不在本 change。
- 不改缓存命中逻辑（24h TTL、force 删除）。

## Decisions

1. **唯一名后缀 = 进程 id + 纳秒时间戳**（与 `unique_backup_path` 同款模式，cli.rs:1038-1042）。同一进程内纳秒时间戳碰撞概率可忽略；跨进程由 pid 区分。不需要 `tempfile` 依赖（已是依赖，但手动命名更贴合"下载中途可能被 `remove_file` 清理"的现有流程——tmp 文件在超限时会被主动 `remove_file`，用 `tempfile::TempDir` 反而要处理析构与 rename 的冲突）。
2. **提取 `zip_tmp_path(cache_dir, owner, repo, branch) -> PathBuf` 私有函数**，唯一逻辑集中一处、可单元测试。`cache_ref_key` 仍用于缓存文件名（幂等 key），唯一性只加在 tmp 层。
3. **rename 的并发语义不变**：两路并发都完成时后 rename 者覆盖，二者内容一致（同分支），最终缓存完整。

## Risks / Trade-offs

- [超限清理只删当前调用的 tmp] → 与现有行为一致（`remove_file(&tmp_path)` 只删自己的），并发下的另一个 tmp 由各自调用清理，无泄漏路径（成功 rename、失败被删除；进程崩溃时遗留 `.tmp` 文件与修复前一样可能残留，属既有行为，不扩大）。
- [Windows rename 目标被占用] → 现有代码已 `drop(file)` 后再 rename（772-774 行），保持不动。

## Migration Plan

无数据迁移。回滚即 revert。
