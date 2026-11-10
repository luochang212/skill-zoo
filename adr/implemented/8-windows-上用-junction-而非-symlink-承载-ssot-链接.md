---
status: implemented
date: 2026-11-11
description: 在改动 Windows 链接创建或检测、或考虑把 junction 换成 symlink 之前阅读。
raised-by: agent
decided-by: agent
created: 2026-11-11
---

# ADR: 8 Windows 上用 junction 而非 symlink 承载 SSOT 链接

## Problem

SSOT 架构要求 agent 目录里的链接指向真实技能目录（见 AGENTS.md「SSOT + 符号链接」）。在 Windows 上，创建真正的 symlink（reparse tag `IO_REPARSE_TAG_SYMLINK`）需要管理员权限或开发者模式——对消费级应用不可接受；而 junction（`IO_REPARSE_TAG_MOUNT_POINT`）两者都不需要。但标准库 `Path::is_symlink()` 只识别 symlink tag，会把应用自己创建的 junction 误判为普通目录，链接处理随之失效。这个权限约束与标准库的识别边界都无法从代码本身推导。

## Decision

- Windows 上创建 junction 而非 symlink（`junction::create`，skill.rs:2114；`junction` crate）。
- 所有链接处理代码经 `is_symlink_or_junction()`（skill.rs:328）判断，不直接用 `Path::is_symlink()`：该函数对 symlink 返回真，Windows 上再经 `junction::exists()` 特异检测 junction reparse tag。
- `junction::exists()` 刻意只匹配 junction tag，不把其他 reparse 点（OneDrive 占位文件、DFS 链接）当成应用链接。
- 链接目标解析：相对目标先按链接父目录解析；`read_link` 失败时（Windows junction 常见）回退为规范化路径比较（skill.rs:350）。

## Alternatives considered

- 真 symlink：被 Windows 权限模型否决——需要提权或开发者模式，普通用户安装即失败。
- 复制而非链接：违反 SSOT 单一来源设计，副本会静默分叉。

## Consequences

- 换得：安装无需提权；SSOT 链接在三个平台行为一致。
- 代价：Windows 链接检测比标准库多一层；调用方必须经 `is_symlink_or_junction()` 而非标准库 API——这一纪律依赖本记录维持。
- OneDrive 占位与 DFS 链接被刻意排除在应用链接分类之外。
- 出处说明：决策先于本记录存在，是注释清除扫荡中从已交付代码捕获的；`decided-by: agent` 反映实现来源。
