## MODIFIED Requirements

### Requirement: 模型思考偏好
添加与编辑模型弹窗 MUST NOT 提供深度思考开关或思考等级选择；模型配置 MUST NOT 保存用户思考偏好。后端 MUST 自动采用适合翻译的策略：仅对已确认的服务、协议与模型发送关闭思考参数；已确认的固定思考翻译配置 MUST 使用已验证的轻量参数，不将其描述为关闭思考；未知组合 MUST 遵循服务默认，MUST NOT 发送未经确认的参数。连接探测、正文翻译与定向修复 MUST 使用同一策略，不增加自动协商、重试或超时预算。翻译缓存身份 MUST NOT 依赖用户思考偏好。

#### Scenario: 添加和编辑模型
- **WHEN** 用户添加或编辑模型
- **THEN** 首个配置项为 Model ID，无深度思考开关，确认仅提交模型标识和现有模型参数，取消不改变草稿

#### Scenario: 支持关闭思考的模型
- **WHEN** 对已确认支持关闭思考的服务、协议与模型发起连接探测、正文翻译或定向修复
- **THEN** 后端发送已适配的关闭思考参数，不提供开启或等级选择

#### Scenario: 固定思考模型的轻量翻译
- **WHEN** 用户通过 https://ark.cn-beijing.volces.com/api/coding/v3/ 使用 OpenAI Chat Completions 的 glm-5.3-flash 或 glm-5-3-flash-260828
- **THEN** 连接探测、正文翻译与定向修复都携带 reasoning_effort=low，不延长超时或自动重试

#### Scenario: 未知服务或模型
- **WHEN** 服务、协议或模型不属于已确认的适配组合
- **THEN** 不额外发送思考控制参数，遵循服务默认
