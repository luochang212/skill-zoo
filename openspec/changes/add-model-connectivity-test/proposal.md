# Proposal

## Why

模型配置可以保存，但用户无法确认地址、凭据、协议和模型是否实际可用。提供显式的最小推理测试，让用户在保存前即可验证当前配置。

## What Changes

- 每个模型提供测试连接操作，反馈等待、成功耗时与安全的失败原因。
- 使用当前未保存连接配置，未替换的凭据仅在 Rust 中读取；测试不保存、不修改翻译偏好或缓存。
- 发送固定短提示、非流式最小推理请求：Chat Completions 与 Messages 输出预算 1 token；Responses 使用协议最低允许的 16 tokens。
- 15 秒总截止，不自动重试，不以模型列表接口可达代替推理可用。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `llm-provider-config`: 当前模型草稿的显式连接测试与安全反馈。

## Impact

模型管理组件、类型化 IPC、Rust LLM 连接层和测试。无新增依赖，不改变持久化格式或本地技能协议。
