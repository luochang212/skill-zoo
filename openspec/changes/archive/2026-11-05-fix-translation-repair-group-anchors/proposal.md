# Proposal

## Why

真实 DeepSeek 请求已证实：模型漏掉 frontmatter 后，修复规划器把合法行内重排误判为损坏；拼接又重复保留与插入 11 个完好标记，导致无效修复及额外 token。最终验证和修复必须使用同一组边界。

## What Changes

- 验证和修复共用源文行标记分组，修复只在完整健康组之间切分。
- 移位或重复标记跨越其他组时，扩大必要的损坏区域，避免坏标记留在健康区域再被插入。
- 固化离线最小回归，并用捕获的真实失败响应验证单次定向修复。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `skill-content-translation`: 定向修复的健康组锚点和损坏区域边界。

## Impact

仅修改 Rust 翻译保护/修复实现、相关测试、调查证据和规格。无新依赖、前端或状态机变更，无额外重试；不修改原始技能或用户配置。
