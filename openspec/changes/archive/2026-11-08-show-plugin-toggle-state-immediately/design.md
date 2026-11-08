# Design

## Context

现有 mutation 已等待保存与扫描完成。组件可直接使用 mutation.variables 呈现 pending 目标，不需要第二套 useState 或全局乐观回滚机制。

## Goals / Non-Goals

立即反馈并保留真实保存状态。不改扫描和持久化边界。

## Decisions

pending 时显示目标值；保存确认后取消可能返回旧值的设置查询，再写入确认值。保存失败时查询缓存仍为原值；扫描失败时缓存已为保存值。失败后重新读取设置校准，并显式提示错误，因为 hook 的 onError 会覆盖应用默认处理。

## Risks / Trade-offs

读取设置也失败时保留最后确认值。扫描仍可能较慢；开关 pending 时保持禁用。
