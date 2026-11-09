# Proposal

## Why

仓库技能列表的加载（ZIP 下载 → 解压 → 扫描）是异步后台任务：可以离开页面继续跑，任务菜单展示阶段与字节进度，但没有中断手段。慢网络下用户只能等它跑完或重启应用；前端注释也明确记录了"页面卸载后 IPC 继续运行"的局限。任务菜单是唯一能看到所有在途任务的地方，缺取消意味着后台任务不可停止。

## What Changes

- 新增 Rust 命令 `cancel_repo_skills`：按 owner/repo/branch 中断在途的 `get_repo_skills` 加载（照 `cancel_translation` 的 AbortHandle 先例）；中断发生在发现阶段，临时 zip 文件由既有 drop 清理机制移除，不发布缓存条目；取消已完成的任务是无副作用的 no-op。
- 任务菜单运行中的条目新增紧凑取消图标（与终止条目的关闭图标同一模式）；激活后立即取消并让条目消失，不做仓库导航，不弹失败通知。
- 正在浏览被取消仓库的详情页从加载态进入安静的"已取消"空态（非错误样式），提供显式"重新加载"；取消状态持久，回到页面或重开页面不自动重下。
- 取消不改变 `get_repo_skills` 的成功路径；`cancel_repo_skills` 不触碰已完成任务与本地状态。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `discover-search`：运行中的仓库加载可从任务菜单取消；取消不是失败；详情页呈现已取消状态且需显式重载。

## Impact

Rust：`store.rs`（AppState 增加取消注册表）、`commands/skill.rs`（`cancel_repo_skills` + 注册/清理逻辑与单测）、`error.rs`（`cancelled` 错误码）、`lib.rs`（命令注册）。前端：`lib/api/skills.ts`、`hooks/useRepoTasks.tsx`（cancel 动作与 toast 抑制）、`components/layout/RepoTasksMenu.tsx`（运行条目取消图标）、`components/skills/RepoDetail.tsx`（已取消空态）、`lib/api/errors.ts`（cancelled 识别）、i18n zh/en。无本地协议、schema 或 fixture 变更；不涉及安装流程。
