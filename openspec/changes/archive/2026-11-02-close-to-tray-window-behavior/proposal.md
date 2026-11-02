# Proposal

## Why

关闭到托盘（设置键 `close_to_tray`）已在 v0.3.60 之后落地：启用后关闭主窗口只是隐藏，进程留在托盘。但 `desktop-ui` 的「后台更新退出确认」仍写着「窗口关闭与托盘退出 MUST 覆盖」，按字面读，任何一次关闭主窗口都必须先弹退出确认。该行为落地时没有开 change，主 spec 与实现已经分叉：后来者按 spec 阅读，会把现在的正确行为当成缺陷去「修复」，反而给一个不会打断任何写入的隐藏动作加回一个没有意义的确认框。

## What Changes

- 记录关闭窗口在启用关闭到托盘时的语义：隐藏而非退出，不是退出入口，不触发退出确认。
- 保留并收紧既有约束：真实退出（窗口关闭、托盘退出）在更新存活时仍必须确认；该约束现在只覆盖真实退出入口。
- 明确恢复入口（托盘「打开主界面」、macOS Dock 图标）与该设置的默认关闭状态。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `desktop-ui`：关闭到托盘改变窗口关闭的语义，退出确认的覆盖范围随之收紧到真实退出入口。

## Impact

Rust 侧 `src-tauri/src/services/update_exit.rs`（关闭分支、Dock 恢复）与 `src-tauri/src/services/tray.rs`（`show_main_window` 提升为 `pub`）；前端 `src/components/settings/WindowBehaviorSettings.tsx` 与 `src/hooks/useSettings.ts`。无依赖、锁/归档 schema 或本地协议形状变化：`close_to_tray` 是纯桌面 UI 偏好，CLI 不解释它，因此 `docs/local-protocol.md` 不新增条目。验证证据与未处理项记录在 design.md。
