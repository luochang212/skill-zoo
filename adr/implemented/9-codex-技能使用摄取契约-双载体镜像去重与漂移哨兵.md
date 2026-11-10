---
status: implemented
date: 2026-11-11
description: 在改动 Codex rollout 解析、使用事件去重或漂移告警之前阅读。
raised-by: agent
decided-by: agent
created: 2026-11-11
---

# ADR: 9 Codex 技能使用摄取契约：双载体镜像去重与漂移哨兵

## Problem

Codex 在外部记录技能使用，格式事实在代码里不可见。三个事实共同决定解析器形状：使用以两种模式发生（AI 主动读 `skills/<name>/SKILL.md` 的工具调用；用户主动以 `$skill` 前缀提及）；rollouts 可能经两个载体投递同一条用户消息（legacy `event_msg` 与当前 user-role `response_item` 镜像重复）；两种当前载体形状都不携带 session id。只解析单一载体或按时间戳朴素去重，都会让使用计数静默失真；而 Codex 上游改变记录格式时不会有任何显式信号。

## Decision

- 解析器同时接受两种模式的全部载体形状：AI 主动（legacy `function_call` 或当前 `custom_tool_call`）、用户主动（legacy `event_msg` 或当前 user-role `response_item`）（`parse_codex_skill_line`，skill_usage.rs:519）。
- 用户消息的去重 id 优先取记录中的 session id；载体形状都缺失时，回退为消息文本前 80 字符的文本指纹，使镜像对折叠为一条记录（`finish_codex_user_message`，skill_usage.rs:629）。
- 漂移哨兵：session 文件引用了 SKILL.md 却没有任何使用事件被归因时，经 stderr 告警——应用今天没有 `log`/`tracing` 订阅者，stderr 是唯一可见于开发控制台与测试输出的通道（`report_codex_drift`，skill_usage.rs:230）。

## Alternatives considered

- 只解析当前载体形状：省代码，但 legacy 形状仍在真实 rollout 中出现，丢一半记录。
- 按（时间戳, 技能名）去重：不足以区分镜像对与真实重复，同一秒内两条不同消息会被误合并。
- 引入 `log`/`tracing` 做告警：为一个警告新增依赖，与"无订阅者"现状不匹配。

## Consequences

- 换得：镜像对正确折叠为一条；格式漂移有显式信号而非静默失真。
- 代价：文本指纹使前 80 字符相同的不同消息被合并——接受的误差；未来载体若携带 session id，应优先用它并缩窄指纹回退。
- 漂移哨兵依赖"无日志订阅者"现状；引入 `log`/`tracing` 时 stderr 通道决策需要重议。
- 出处说明：决策先于本记录存在，是注释清除扫荡中从已交付代码捕获的；`decided-by: agent` 反映实现来源。
