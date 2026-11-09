# Design

## Context

仓库加载的完整链路是前端 `useRepoTasks`（React Query + `inFlight` 去重）→ `get_repo_skills` 命令 → `discover_from_repo_capped`（ZIP 流式下载到 tempfile → 解压 → 扫描）→ `rebuild_cache` + 冲突分类。取消只属于这条链路；安装（`install_skills`）不受影响。仓库里已有同构先例：翻译任务的 `TranslationState`（start/cancel/take/commit + AbortHandle），以及 `repo-zip-download` spec 已保证"download future dropped → 临时文件清理、不发布缓存"——用户取消产生的正是 future drop，清理免费获得。

## Goals / Non-Goals

**Goals:** 用户可从任务菜单停止任一在途仓库加载；取消不是失败；详情页有诚实的已取消状态；取消后可显式重载。

**Non-Goals:** 安装/更新流程的取消；断点续传；详情页内的取消入口（控制面只在任务菜单）；对取消做任何持久化记录。

## Decisions

1. **取消注册表放在 AppState**：`repo_load_cancels: RepoLoadCancels`（`Mutex<HashMap<String, Arc<AbortHandle>>>`，key 为 `owner/name@branch|HEAD`）。不学 translation 的 start/take/commit 三段式——仓库加载没有"提交"临界区要保护，注册 + abort + 清理三步即可。
2. **Abortable 只包发现阶段**：`Abortable::new(discover_from_repo_capped(...), registration)`。中止发生在网络/解压/扫描期；discover 已完成后进入的 `rebuild_cache` 与分类步骤不被打断（它们要么整体不开始，要么整体完成）。若取消落在 discover 与 rebuild 之间，命令正常返回成功——取消与完成竞争时完成获胜，与"取消已完成任务是 no-op"一致。
3. **清理只删自己的句柄**：任务结束时按 `Arc::ptr_eq` 比对后移除，防止"取消后立刻重载"的窗口里旧任务清掉新任务的句柄（前端 `inFlight` 去重不覆盖这个跨任务的间隙）。
4. **错误码 `cancelled`**：`CommandError::cancelled()`（静态 code，照既有错误码约定序列化）。前端以 `error.code === "cancelled"` 识别，不进 `ERROR_KEYS` 文案表——已取消不渲染为错误文案。
5. **前端取消动作 = 调 IPC + 乐观 dismiss**：`cancel(repo)` 发出 `cancel_repo_skills` 后立即 dismiss 条目（条目即刻消失）。错误落地时既有 toast 条件已覆盖：dismissed 条目与 activeKey 页面错误都不 toast。`load()` 开始时会把 `dismissed` 复位，重载后条目自然回来。
6. **详情页特判而非新状态机**：`isError && code === "cancelled"` 时渲染安静空态（中性图标 + "加载已取消" + 复用 `error.retry` 文案的重载按钮），复用现有错误分支结构。error 态 query 的 enabled 条件本就不自动重取，取消持久性无需额外代码。
7. **IPC 忽略失败**：`cancel` 的 promise 静默 catch——取消到达时任务已完成是预期 no-op（Rust 侧也返回 Ok），前端不为它报错。

## Risks / Trade-offs

- [取消后立刻重载，新旧下载短暂重叠] → 写入唯一命名的 tmp 文件，最坏浪费流量；`Arc::ptr_eq` 保证新句柄不被旧任务误删。
- [菜单控制面可发现性弱于页面内按钮] → 接受；header 图标在任务运行时有动画提示，详情页入口可作未来增量。
- [乐观 dismiss 与 IPC 失败的窗口] → Rust 侧 cancel 恒返回 Ok；唯一失败模式是应用状态异常，届时条目重新出现于下一次 load。

## Migration Plan

无迁移、无 schema 变更。新增命令进 invoke_handler；i18n 增两个 key（`repoTasks.cancelRepo`、`repoLoadCancelled`），zh/en 同改。
