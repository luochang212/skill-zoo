# Tasks

## 1. Rust 后端

- [x] 1.1 `store.rs` 增加 `RepoLoadCancels` 注册表（register/cancel/finish，`Arc::ptr_eq` 只清自己的句柄）并挂到 `AppState`；单测覆盖 register→cancel→no-op、finish 不误删新句柄。
- [x] 1.2 `commands/skill.rs`：`get_repo_skills` 注册句柄、`Abortable` 包裹 discover、被取消返回 `cancelled` 码；新增 `cancel_repo_skills` 命令（幂等 no-op）；`error.rs` 加 `CommandError::cancelled()`；`lib.rs` 注册命令。
- [x] 1.3 单测：取消在 discover 前后到达的语义（前 → cancelled 错误；后 → 命令成功），照 translation 的 before/after 测试模式。

## 2. 前端

- [x] 2.1 `lib/api/skills.ts` 加 `cancelRepoSkills`；`lib/api/errors.ts` 加 `isCancelledError`。
- [x] 2.2 `useRepoTasks` 加 `cancel(repo)`：IPC + 乐观 dismiss；`useRepoTask` 暴露给详情页；验证取消不触发失败 toast。
- [x] 2.3 `RepoTasksMenu`：运行中条目加紧凑取消图标（可访问名称、不触发导航），终止条目行为不变。
- [x] 2.4 `RepoDetail`：`cancelled` 错误渲染安静空态（中性图标 + 文案 + 重载按钮），普通错误分支不变。
- [x] 2.5 i18n：zh/en 同步增加 `repoTasks.cancelRepo`、`repoLoadCancelled`。

## 3. 测试与验证

- [x] 3.1 前端测试：`useRepoTasks`（取消 → 条目消失 + 无 toast + 重载重启）、`RepoTasksMenu`（运行行取消 ✕）、`RepoDetail`（cancelled 空态 vs 普通错误）。
- [x] 3.2 运行 `cargo test`、`bun run test`、`lint`、`format`、typecheck；`openspec validate --all --strict`；同步主 specs 并归档。
