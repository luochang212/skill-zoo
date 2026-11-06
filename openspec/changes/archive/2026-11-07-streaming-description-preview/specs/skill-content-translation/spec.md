## ADDED Requirements

### Requirement: 流式说明及时展示

description 与正文 MUST 继续使用同一次模型请求。流式输出包含唯一、完整、有序的 description 起止标记及非空译文后，预览 MUST 将译文安全序列化回 frontmatter，无需等待正文生成结束；其余字段的语义值 MUST 保留。description 尚未完整或标记异常时 MUST 保留原头部。预览 MUST NOT 绕过最终保真校验或写入未完成缓存。

#### Scenario: 正文尚未完成
- **WHEN** description 标记和值已完整到达，正文仍在生成
- **THEN** 顶部 description 显示译文，正文继续流式更新，不发起额外模型请求

#### Scenario: 不完整或异常说明
- **WHEN** description 结束标记尚未到达、值为空或边界标记重复或逆序
- **THEN** 预览保留原 description，最终输出仍由既有保真校验决定是否可缓存
