## ADDED Requirements

### Requirement: 协议请求路径与认证
连接测试与翻译 MUST 复用相同协议路由和认证。Anthropic Messages MUST 在 API 根路径末尾尚无 `/v1` 时补齐该前缀，再调用 `messages`，已有 `/v1` MUST NOT 重复添加；非空 Key MUST 同时用于 `x-api-key` 和 Bearer Authorization，保留 `anthropic-version: 2023-06-01`。Chat Completions 与 Responses MUST 保留用户填写的 API 根路径，分别调用 `chat/completions` 与 `responses`，非空 Key 使用 Bearer Authorization。空 Key MUST 不发送认证头，不读取环境凭据；MUST NOT 改写持久化地址或自动重试。

#### Scenario: Anthropic 网关根地址
- **WHEN** 用户使用根路径为 `/anthropic/` 的 Anthropic 兼容服务
- **THEN** 连接测试和翻译请求 `/anthropic/v1/messages`，非空 Key 同时出现在两种认证头中

#### Scenario: 已带版本与自定义 OpenAI 根路径
- **WHEN** Anthropic 地址已以 `/v1/` 结束，或 OpenAI 协议配置了自定义根路径
- **THEN** Anthropic 只添加 `messages`，OpenAI 协议保留根路径并添加对应接口后缀，不擅自添加 `/v1`

#### Scenario: 匿名服务
- **WHEN** 任一协议使用空 Key
- **THEN** 测试与翻译均不发送 `x-api-key` 或 Authorization，不回退到环境中的凭据

### Requirement: 模型流错误安全分类
模型服务在 HTTP 200 流中返回显式错误，或因协议数据无法解析而失败时 MUST 报告 `providerResponse`，而非网络连接失败；HTTP 401/403、429 与超时 MUST 继续使用各自安全分类。错误反馈 MUST NOT 包含上游响应、模型输入或凭据，MUST NOT 自动重试或将部分输出当作成功。

#### Scenario: 服务端流错误
- **WHEN** 三种协议之一在 HTTP 200 流中返回错误事件
- **THEN** 翻译失败并报告安全的服务响应错误，不返回部分译文或泄漏服务端错误正文

#### Scenario: 非法流数据
- **WHEN** Chat Completions 或 Messages 返回无法解析的正文事件
- **THEN** 报告服务响应错误，不误导用户排查网络
