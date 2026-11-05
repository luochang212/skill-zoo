## MODIFIED Requirements

### Requirement: 模型流错误安全分类
模型服务在 HTTP 200 流中返回显式错误，或因协议数据无法解析而失败时 MUST 报告 `providerResponse`，而非网络连接失败；HTTP 401/403 与超时 MUST 继续使用各自安全分类；HTTP 429 的结构化 error.code 明确为 AccountQuotaExceeded 时 MUST 报告 quotaExceeded，其他或无法识别的 429 MUST 保持 rateLimit，不根据自由文本推断额度状态。错误反馈 MUST NOT 包含上游响应、模型输入或凭据，MUST NOT 自动重试或将部分输出当作成功。

#### Scenario: 服务端流错误
- **WHEN** 三种协议之一在 HTTP 200 流中返回错误事件
- **THEN** 翻译失败并报告安全的服务响应错误，不返回部分译文或泄漏服务端错误正文

#### Scenario: 非法流数据
- **WHEN** Chat Completions 或 Messages 返回无法解析的正文事件
- **THEN** 报告服务响应错误，不误导用户排查网络

#### Scenario: 套餐额度耗尽
- **WHEN** 连接测试或翻译请求返回 HTTP 429，结构化错误码为 AccountQuotaExceeded，包括被流错误包装的响应
- **THEN** 返回安全的 quotaExceeded 分类；其他 429 仍为 rateLimit，401/403 仍为 authentication，不透传上游错误正文、凭据或请求编号
