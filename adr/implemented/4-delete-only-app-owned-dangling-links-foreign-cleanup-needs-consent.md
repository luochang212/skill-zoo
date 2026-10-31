---
status: implemented
date: 2026-10-24
raised-by: agent
decided-by: human
created: 2026-10-24
commit: 5cd578f
description: 在改动 skill 删除或符号链接清理行为之前阅读，尤其是任何会删除应用不拥有的文件的操作。
paths:
  - src-tauri/src/services/skill.rs
  - src-tauri/src/commands/agents.rs
---

# ADR: 4 只删除应用自己拥有的悬空链接；清理他人链接需征得同意

## Problem

扫描期清理曾经会删掉它在 agent skill 目录里发现的每一个悬空符号链接或 junction，不问链接是谁创建的。扫描在启动时与 watcher 事件时都会跑，因此任何瞬时状态都有多次机会被判定为垃圾。

agent skill 目录里确实存在应用并未创建的链接。用户会把单个 skill 或整个 `~/.claude/skills` 目录软链到 dotfiles 仓库、`~/.agents/skills` 或 git submodule（[claude-code#36659](https://github.com/anthropics/claude-code/issues/36659)、[#38051](https://github.com/anthropics/claude-code/issues/38051)、[skills#293](https://github.com/vercel-labs/skills/issues/293)），而「悬空」往往是瞬时的：submodule 反初始化，或目标目录正在重组。删除这样的链接是静默且不可逆的。旧规则还会删掉 Skill Zoo 自己建的协议链接：一个指向别的 agent 主目录的 `origin=agent` 链接，在扫描期与外来链接无法区分，于是用户整理目录期间的一次扫描就删掉了应用自己创建的链接。

生态证据表明悬空状态是一大类而非长尾：某个竞品专门带 `symlink_valid` 字段，正因为用户会移动或删除目标文件（见 `openspec/changes/archive/2026-10-14-research-competitor-skill-managers-co-design/evidence/dossiers/` 下的 OPC-Skiller 档案），而 dotfiles 工具（Tuckr）自带悬空链接检查器，只报告、不删除。没有主流管理器会静默删除它没创建的链接。

## Decision

- 自动清理只可移除应用拥有的链接：其字面目标位于 `~/.agents/skills/` 内，或在能拿到 home 集合的操作路径上位于已知 agent 主目录内（`is_app_owned_link`）。
- 外来或无法分类的悬空链接绝不静默删除，原样保留。
- 归属由链接目标的位置推断，而非在创建时记录，且该推断刻意偏向「少删」。两种近似误差都接受：用户手动指向 SSOT 的链接可能被当作我们的清掉；应用指向 agent 主目录的链接在扫描期可能作为杂物存活。
- 处理外来链接的正式途径是征得同意的界面：列出它们及其目标路径，只在用户明确操作时删除。归属定义默认边界；同意扩展边界。

## Alternatives considered

- **继续删除所有悬空链接。** 否决：它基于某一时刻的存在性检查摧毁用户创建的链接，而失败只会在目标回来时才显现。它甚至在用户整理目录时删掉了应用自己的 `origin=agent` 链接。
- **什么都不删，包括应用自己的残留。** 否决：中断的操作或外部删除的 SSOT 条目留下的链接会永久累积，没有自愈能力。
- **在链接上记录创建者元数据。** 否决：符号链接语义不携带创建者信息；为一条清理启发式做 sidecar 记账，成本高于它防住的杂物。

## Consequences

静默且不可逆地删除应用不拥有的条目，这条路被关闭；应用自己的跨 agent 链接能在用户整理目录后存活。代价是：外来悬空链接会累积且暂时没有清理途径；扫描期清理会漏掉指向 agent 主目录的应用链接，因为扫描调用点传的是空的已知 home 集合。两者都是可见、可恢复的杂物，而不是数据丢失。

### Verification

`src-tauri/src/services/skill.rs` 中的回归测试 `scan_keeps_foreign_dangling_links_but_cleans_app_owned_ones` 钉住了边界两侧。发现经过与证据见 `docs/reviews/2026-10-24-code-review-triage.md`。

### Trade-offs

「发生率低」的论据不能推翻这个选择。如果外来悬空链接很罕见，保留它们不花任何成本，无条件删除也换不来什么；删除只在这种链接确实存在的世界里才有收益，而恰恰在那个世界里，瞬时状态让删除变得危险。

### Follow-ups

- 建征得同意的清理界面：列出外来悬空链接及其目标路径，提供一键删除。
- 排队中的崩溃窗口恢复清扫必须对孤儿临时目录与链接套用同一套归属边界。
