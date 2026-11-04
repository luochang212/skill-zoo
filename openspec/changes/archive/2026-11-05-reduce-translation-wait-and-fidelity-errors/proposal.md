# Proposal

## Why

DeepSeek 实测中关闭思考将长文首个正文片段从约 41 秒降至 0.7 秒，并减少约 74% token。当前保真校验还会把中文正常语序产生的行内标记重排误判为损坏。

## What Changes

- 模型编辑第一项增加默认关闭的深度思考开关，后端判断是否可操作，界面不显示能力或加载状态。
- 已确认的接口按模型偏好设置思考参数；未知或固定思考模型不发未经确认的参数，不试探、不自动重试。
- 允许同一源文行内的保护标记重排，继续校验完整性及源文行之间的结构顺序。
- 保持整篇单请求流式展示及最多一次定向修复，不引入并发或整篇 JSON 翻译。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `llm-provider-config`: 模型思考偏好和后端控制的可操作开关。
- `skill-content-translation`: 行内保护的允许重排范围与单请求流式策略。

## Impact

模型持久化、typed IPC、模型编辑弹窗、LLM 参数构造、保护校验、缓存身份及相关测试。无新依赖；不涉及技能锁、CLI 本地协议或原始技能文件。证据见 docs/research/translation-benchmark/README.md。
