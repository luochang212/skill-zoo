# Proposal

## Why

Tauri 升级评估（worth-fix）确认三处值得修的项：

1. 应用可双开，且跨进程写防护只覆盖进程内：`lock.rs` 互斥为 process-wide，跨进程 `SkillLock` 读改写可丢字段（不自愈）；`persistence::atomic_write` 的临时文件同名共享，跨进程并发写存在撕裂窗口（缓存损坏可经空缓存回退 + 后台重建自愈）。实测双开两进程并存，无任何内置拦截。
2. CSP `connect-src` 白名单的 4 个 github 域在前端已无任何调用（无 fetch/axios/XHR），属扩大网络面的死配置。
3. 反馈按钮在 opener 失败时回退 `window.open`，桌面端被 wry 默认拒绝（无 handler 时返回 None），用户得不到任何反馈。

## What Changes

- 引入官方 `tauri-plugin-single-instance`：二次启动时聚焦既有主窗口，第二个进程立即退出；插件注册置于所有插件之前。
- 收紧 CSP：`connect-src` 移除 `https://api.github.com`、`https://github.com`、`https://objects.githubusercontent.com`、`https://github-releases.githubusercontent.com`，仅保留 IPC 所需。
- 反馈按钮 opener 失败时以 toast 提示错误并记录日志，移除无效的 `window.open` 回退。

## Capabilities

### New Capabilities

- `app-lifecycle`: 单实例启动语义。

### Modified Capabilities

无。

## Impact

- `src-tauri/Cargo.toml`、`src-tauri/src/lib.rs`（新增依赖与插件注册）、`src-tauri/tauri.conf.json`（CSP）、`src/components/settings/AboutSection.tsx`、`src/i18n/en.json`、`src/i18n/zh.json`、新增 `src/components/settings/AboutSection.test.tsx`。
- 无本地协议、扫描算法或 CLI 变化。实证证据（双开实测、wry 新窗口默认拒绝、前端零 GitHub 调用）见 verification.md。
