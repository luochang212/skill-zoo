# Proposal

## Why

翻译头部读取依赖 YAML 解析器，回填却依赖正则行范围，两者对合法多行字符串的边界可能不一致，导致合法技能生成非法译文头部。用户已接受译文 YAML 排版变化，以换取字段语义保真。

## What Changes

- 按用户确认，离页或切换文件不再取消翻译；同一应用会话内返回时接续进度和结果，手动取消保留。

- 使用现有 YAML 解析器读取完整头部对象，仅替换 description 值并序列化完整头部。
- 保留 name 和其他字段的语义值；不承诺译文头部的注释、引号和块样式保持不变。
- 更新缓存策略版本，避免命中旧机制结果；不修改源文件，不自动补译。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `skill-content-translation`: 明确 frontmatter 按字段语义保护，译文排版允许规范化。

## Impact

影响 Rust 翻译保护与还原、前端阅读器、应用级翻译会话、相关测试及翻译规格。不改变 IPC、缓存文件结构或技能源文件。
