## MODIFIED Requirements

### Requirement: 显式最小推理连接测试
每个模型 MUST 提供显式测试连接操作，使用当前未保存的协议、地址、模型和凭据。测试 MUST 发出一次固定短提示的非流式推理请求，不请求模型列表、不自动重试。Chat Completions 与 Messages 输出预算 MUST 为 1 token，Responses MUST 使用其最低允许的 16 tokens。测试 MUST 在 15 秒内结束；预算耗尽或正文为空但响应结构及结束状态有效时 MUST 判为可用，不沿用翻译的非空完整正文要求。

#### Scenario: 空正文的最小推理
- **WHEN** 服务返回有效推理结构且因输出预算耗尽结束，正文为空
- **THEN** 测试成功并显示耗时，不显示翻译截断错误

#### Scenario: 无效或失败响应
- **WHEN** 请求超时、鉴权失败、限流，或服务返回非推理响应
- **THEN** 测试失败并显示安全的原因，不将 HTTP 200 单独视为成功

#### Scenario: 兼容服务返回无签名思考
- **WHEN** 服务返回成功的 Messages 响应，content 为数组，stop_reason 为 end_turn 或 max_tokens，但 thinking 内容缺少 signature
- **THEN** 连接测试依据原始响应结构与结束状态判为成功，不因 SDK 的正文解码失败而报告供应商拒绝；HTTP 错误、缺失或失败结束状态、无效结构仍报告失败，不自动重试
