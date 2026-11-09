# Verification

- Rust：`cargo test --features test-helpers --lib` 349 通过（含 `store::tests` 新增 4 个取消注册表用例：abort 传播、finish 不误删重载句柄、无任务时 no-op、完成后 no-op）；`cargo clippy --features test-helpers -- -D warnings` 干净。
- 前端：`bun run test` 54 个文件 500 用例全绿，含新增 3 个用例——`useRepoTasks`（取消 → 条目消失 + 无失败 toast + 重载强制重取）、`RepoTasksMenu`（运行条目取消 ✕ 触发 IPC、不导航、条目立即消失）、`RepoDetail`（cancelled 空态不渲染错误文案与原始错误，重载按钮可达）。
- 质量门：`bun run lint` 0 警告 0 错误；`format:check`、`typecheck` 通过。
- 规格：`openspec validate cancel-repo-load --strict` 通过；归档后主 specs 已同步。

设计取舍记录：取消只包发现阶段，`rebuild_cache` 不被打断（design.md 决策 2）；临时 zip 清理沿用 `repo-zip-download` 既有的 future-drop 语义，未新增清理代码。
