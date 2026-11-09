# Design

## Context

worth-fix 评估坐实：双开实测两进程并存；`lock.rs` 互斥为 process-wide，跨进程 `SkillLock` 读改写可丢字段；`persistence::atomic_write` 的临时文件同名共享，跨进程并发写存在撕裂窗口（缓存损坏可经 `lib.rs` 的空缓存回退 + 后台重建自愈；lock 元数据丢失不自愈）。触发概率低（macOS Finder 双击天然去重，需 `open -n`/CLI/Windows 快速双击；6 个月零 issue），但机制真实且修复成本约两行，后悔不对称成立。

## Goals / Non-Goals

- Goals: 消除双开竞态面；收紧无用的 CSP 网络白名单；失败路径有用户可见反馈。
- Non-Goals: 不为多实例语义提供支持（插件的 `semver` feature 等）；不单独修 `atomic_write` 的跨进程窗口（单实例落地后该路径不可达）。

## Decisions

- 使用官方 `tauri-plugin-single-instance`（macOS 走 Unix socket，按 bundle identifier 去重），回调内 show/unminimize/set_focus 主窗口。注册必须是第一个插件：插件文档要求其初始化先于其他插件，保证转发语义完整。
- CSP `connect-src` 仅保留 `'self' ipc: http://ipc.localhost`。`img-src` 的远程图片（README 徽标经 `raw.githubusercontent.com`）不受影响：`connect-src` 不约束 `<img>` 加载。
- opener 失败改用与 `MarkdownContent` 一致的 `toast.error` + `console.error`；`window.open` 在 wry 桌面端默认 no-op，回退是死路径。

## Risks / Trade-offs

- dev 构建与 release 构建共用 identifier，二者不能同时运行（对开发者可接受，属预期行为）。
- 单实例回调无法进程内单测（进程级语义），依赖真机双开验证，证据记录于 verification.md。
