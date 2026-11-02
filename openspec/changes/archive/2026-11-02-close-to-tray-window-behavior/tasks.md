# Tasks

## 1. 记录关闭到托盘语义

- [x] 1.1 收紧 `desktop-ui`「后台更新退出确认」：窗口关闭仅在未启用关闭到托盘时算真实退出入口；启用时隐藏、不确认、进程与更新继续。新建该 requirement 的 delta（MODIFIED）。

## 2. 文案与恢复路径

- [x] 2.1 恢复退出路径指引：`closeToTrayDesc` 与启用 toast 说明「退出请用菜单栏图标的『退出』」，把「最小化」改为「隐藏」（窗口不进入任务栏/Dock 的最小化状态）。zh/en 同步。

## 3. 集成

- [x] 3.1 `openspec validate --all --strict`、`adrkit validate --all`、前端 lint/type/test 全绿；证据与未处理项写入 design.md。

## Workflow follow-up

- Sync affected main specs and archive the completed change; verify the archive and main specs with strict validation.
