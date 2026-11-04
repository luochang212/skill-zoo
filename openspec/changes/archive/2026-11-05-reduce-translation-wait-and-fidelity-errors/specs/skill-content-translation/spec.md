## MODIFIED Requirements

### Requirement: 受保护内容保真
围栏代码块、行内代码、链接目标和 frontmatter 非 description 字段 MUST 通过确定性保护保持原文；description 可翻译。保护标记缺失、重复或被改写时 MUST 失败且不缓存。同一受保护源文行内的行内标记 MUST 允许为目标语言语序重排；不同源文行、独立代码块和 frontmatter 标记之间的相对顺序 MUST 保留，description 边界 MUST 完整且有序。提示词 MUST 要求自然语言中的路径/命令、Markdown 结构与已为目标语言的内容保持原样，但不得将模型质量目标宣传为所有自然语言命令均可安全执行。

#### Scenario: 模型改坏标记
- **WHEN** 返回结果丢失保护标记
- **THEN** 先弹出修复提示并发起一次定向修复；修复后仍未通过才显示保真失败，保留原文与已有成功结果，不写新缓存

#### Scenario: 行内语序重排
- **WHEN** 同一源文行内的标记都原样出现一次，仅因中文语序改变先后
- **THEN** 成功还原，不发起修复，不将正常译文判为损坏

#### Scenario: 跨行或块级标记移动
- **WHEN** 标记被移至另一源文行的标记之前或越过代码块、frontmatter 边界
- **THEN** 校验拒绝该结构变化，不直接当作成功缓存

## ADDED Requirements

### Requirement: 单请求渐进正文
首次翻译 MUST 使用当前整篇 Markdown 的单个流式请求，正文按服务返回顺序渐进显示，MUST NOT 引入分段并行或整篇 JSON 译文包装。已有的加载、取消、重译保留旧结果与最多一次定向修复规则保持有效，MUST NOT 为思考偏好增加翻译状态机分支。

#### Scenario: 首段到达
- **WHEN** 单请求收到第一段正文
- **THEN** 通过既有预览事件逐步显示译文，不等待全部正文完成，不按并发块重排页面
