## MODIFIED Requirements

### Requirement: 单请求渐进正文
首次翻译 MUST 使用当前整篇 Markdown 的单个流式请求，正文按服务返回顺序渐进显示，MUST NOT 引入分段并行或整篇 JSON 译文包装。已有的加载、取消、重译保留旧结果与最多一次定向修复规则保持有效，MUST NOT 为思考参数策略增加翻译状态机分支。

#### Scenario: 首段到达
- **WHEN** 单请求收到第一段正文
- **THEN** 通过既有预览事件逐步显示译文，不等待全部正文完成，不按并发块重排页面
