## ADDED Requirements

### Requirement: Markdown 阅读器支持 CJK 强调边界

共享 Markdown 阅读器 MUST 支持 CJK-friendly 强调及 GFM 删除线边界，覆盖技能详情、技能预览与仓库 README；扩展仅影响解析展示，MUST NOT 改写来源文件，MUST 保留现有 GFM、代码字面量与 HTML 清洗行为。

#### Scenario: CJK 标点后紧接正文
- **WHEN** 文档包含 `**技术栈：**React`、`**技術（説明）**です` 或 `**이 괄호(parenthesis)**가`
- **THEN** 成对星号内的内容显示为加粗，后续正文保持普通文本

#### Scenario: CJK 删除线
- **WHEN** 文档包含 `~~这些文字。~~后面没有空格`
- **THEN** 成对波浪线内的内容显示为删除线

#### Scenario: 字面量与安全边界
- **WHEN** 文档包含转义星号、行内代码、围栏代码块、结束标记前空白或不安全 HTML 与链接
- **THEN** 阅读器保留字面量和代码语义，不强制修复空白边界，继续清洗不安全 HTML 与链接
