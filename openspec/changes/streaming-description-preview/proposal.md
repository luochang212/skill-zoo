## Why

正文流式显示时，preview 始终恢复原 frontmatter，导致已收到的 description 译文直到请求结束才可见。

## What Changes

- 完整有效的 description 在流式预览阶段即可显示译文。
- 不完整或异常标记保留原头部；最终校验、缓存与单请求不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `skill-content-translation`: 流式说明及时展示。

## Impact

仅 Rust ProtectedMarkdown 预览与测试；无前端事件、缓存格式或供应商调用变化。
