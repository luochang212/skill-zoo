# Proposal

## Why

插件开关点击后先禁用、扫描结束后才移动，无法及时表达用户操作。用户确认应立即切换，并区分保存失败与后续扫描失败。

## What Changes

- Pending 时显示本次操作的目标值，同时禁用重复操作。
- 保存成功立即记录已确认设置；保存失败恢复原值，扫描失败保留保存成功的值。
- 失败提示复用现有错误格式，重新读取设置失败也不丢失已确认状态。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `plugin-skill-visibility`: 开关反馈和分阶段失败状态。

## Impact

仅维护组件、设置 mutation hook、对应前端测试与规格；无后端、协议、扫描算法或依赖变化。
