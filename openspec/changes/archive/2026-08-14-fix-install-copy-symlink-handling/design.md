# Design: fix-install-copy-symlink-handling

## Context

`copy_dir_contents`（src-tauri/src/services/cli.rs:861）是安装（`add_skills`）与更新（`reinstall_skill_from_discovered`）共用的复制原语，输入是 zip 解压后的技能目录（GitHub 归档保留 symlink，zip 8.6.0 `extract` 物化为真实软链）。当前实现先 `path.is_dir()`（stat，跟随软链）后 `is_symlink_or_junction`（lstat），导致目录软链被当普通目录递归；文件软链的 `read_link` 结果直接 `exists()`/`copy`，相对目标按进程 CWD 解析。同文件 `scan_dir`（发现阶段）已有 `depth > 20` 上限且跳过软链目录——复制阶段缺同样的防护。

## Goals / Non-Goals

**Goals:**
- 复制阶段对软链接的处理与发现阶段（`scan_dir`）策略一致：不跟随目录软链、文件软链按链接所在目录解析。
- 复制递归有明确深度上限，超限报错而非无界递归。
- 回归测试覆盖四个已复现场景（外部目录、循环、有效相对链、CWD 误拷）。

**Non-Goals:**
- 不改 zip 解压行为（归档如实物化仓库内容，边界控制在复制阶段收口）。
- 不追溯清理 SSOT 中已安装的技能。
- 不支持"跟随归档根内的目录软链"（见风险节，未来可加）。
- 不处理硬链接（zip 归档不包含硬链接）。

## Decisions

1. **目录软链：直接跳过（不复制、不重建链接）。**
   备选 a) 在目标重建软链——SSOT 的设计约定是技能目录存真实文件、软链只出现在 agent 目录，重建会破坏该约定；备选 b) 仅当解析目标落在解压根内才跟随——需要 canonicalize + 边界判断，且仍要防环，复杂度换不回明确收益。跳过与 `scan_dir` 现行策略一致：经由软链目录可达的内容在发现阶段本来就不可见，复制阶段跟随它属于行为不一致。

2. **文件软链：以 `link.parent().join(target)` 解析后再判定。**
   相对 target 语义上就是相对链接所在目录（POSIX）；解析后 `metadata().is_file()` 为真才复制内容，否则（悬空、目录、设备文件等）跳过。绝对 target 同样经此路径统一处理。禁止再对裸 target 调用 `exists()`/`copy`。

3. **判断顺序：symlink 检查移到 `is_dir()` 之前。**
   分支序为「软链 → 目录 → 普通文件」。这是修 bug 的最小改动点：不动函数签名以外的调用方。

4. **深度上限：`depth > 20` 时返回错误。**
   数值与 `scan_dir` 对齐。`scan_dir` 超限是静默截断（发现场景可接受），复制是数据搬运，静默截断等于无声丢文件，故选显式报错使该技能安装失败。

## Risks / Trade-offs

- [合法的仓内目录软链内容在安装后缺失] → 已知取舍：旧行为对这类链同样不可靠（相对链按 CWD 解析，大概率丢失或错拷）。如真实仓库反馈需要，后续可加"仅限归档根内跟随"策略，规格需同步 MODIFIED。
- [Windows junction 的测试盲区] → junction 走 `is_symlink_or_junction` 同一分支，逻辑与目录软链等价；回归测试 `#[cfg(unix)]`（symlink 创建），junction 路径依赖既有 CI 平台覆盖。
- [超深合法目录被拒] → 上限与发现阶段一致，超过 20 层的技能在发现阶段本就不可见，实际不可达。

## Migration Plan

单函数行为修改，无数据迁移；仅影响新安装/更新路径，已安装技能不受影响。回滚即 revert。
