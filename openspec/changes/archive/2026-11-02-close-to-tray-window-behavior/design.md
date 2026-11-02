# Design

## Context

`3bd4f55` 落地了「关闭时留在托盘」。实现把关闭请求分成两支：启用 `close_to_tray` 时 `prevent_close()` + `hide()`；否则保持既有逻辑，更新存活时 `prevent_close()` + `app.exit(0)` 走退出确认。两支互斥，命中第一支就不可能再走确认。

## Decisions

### 1. 规格把「关闭窗口」建模成条件性的退出入口

既有需求的意图是「不要在安装/更新写到一半时把进程杀掉」。隐藏不杀进程，因此不触发该确认，意图仍然满足；字面条款需要跟着意图收紧。

被否的方案：

- **启用托盘后仍在关闭时弹确认**：确认的目的是防止打断进行中的写入，而隐藏不打断任何写入。弹框只会让「关闭」这个动作变得莫名沉重，且用户点「取消」后窗口也不会出现。
- **把托盘驻留改成默认行为**：改变所有用户的既有退出预期，超出本 change 的范围，且没有用户价值支撑。

### 2. 只在需求层收紧覆盖范围，不改既有默认路径

未启用 `close_to_tray` 时逐行保持原行为（含 `app.exit(0)` 的确认链），因此这次改动不触碰任何既有测试的假设。

## 未处理项（有据可查，不在本 change 修）

- **无单实例**：启动时 `setup` 会先取进程级写租约（`src-tauri/src/lib.rs` 的 `AgentLease::acquire`），第二个实例直接启动失败。所以关闭到托盘不会造成双写；它造成的是「窗口藏起来后，重新启动应用这条恢复路径是死的」。修复需要单实例插件并改动启动顺序，已在 `docs/reviews/2026-10-24-code-review-triage.md`（Queued 第 4 条）登记为「需要自己的设计 change，不要顺手做」。
- **Linux 无托盘宿主**：托盘图标依赖 StatusNotifier 宿主，GNOME 默认没有。本机无法在真实 Linux 桌面验证托盘创建返回值与图标可见性是否可分，因此不在此处写未经实测的兜底逻辑；作为已知恢复风险保留。

## Verification

- 结构验证：`update_exit.rs` 的两支互斥（`if stay_in_tray { … } else if should_preserve_window() { … }`），命中隐藏分支后不可能进入确认分支。
- 单测：`cargo test --features test-helpers --lib services::update_exit` 5/5 通过（含 `close_to_tray_setting_defaults_to_off`）。
- 前端：`bun run test` 270/270、`bun run lint` 0/0、`bunx tsc --noEmit` 无输出。
- 未能实测：真实应用中的托盘点击与 Dock 恢复需要运行桌面壳层，本环境不可执行；该行为由代码路径与既有 `show_main_window` 复用保证，未做运行时验证。
