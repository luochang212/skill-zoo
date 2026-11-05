## MODIFIED Requirements

### Requirement: 受保护内容保真
围栏代码块、行内代码和链接目标 MUST 通过确定性保护保持原文；frontmatter 非 description 字段 MUST 保持语义值；description 字符串值可翻译。有效 frontmatter 的译文 MUST 保持合法 YAML，允许规范化引号、缩进和块样式及移除注释，MUST NOT 修改技能源文件。保护标记缺失、重复或被改写时 MUST 失败且不缓存。同一受保护源文行内的行内标记 MUST 允许为目标语言语序重排；不同源文行、独立代码块和 frontmatter 标记之间的相对顺序 MUST 保留，description 边界 MUST 完整且有序。提示词 MUST 要求自然语言中的路径/命令、Markdown 结构与已为目标语言的内容保持原样，但不得将模型质量目标宣传为所有自然语言命令均可安全执行。

#### Scenario: 模型改坏标记
- **WHEN** 返回结果丢失保护标记
- **THEN** 先弹出修复提示并发起一次定向修复；修复后仍未通过才显示保真失败，保留原文与已有成功结果，不写新缓存

#### Scenario: 行内语序重排
- **WHEN** 同一源文行内的标记都原样出现一次，仅因中文语序改变先后
- **THEN** 成功还原，不发起修复，不将正常译文判为损坏

#### Scenario: 跨行或块级标记移动
- **WHEN** 标记被移至另一源文行的标记之前或越过代码块、frontmatter 边界
- **THEN** 校验拒绝该结构变化，不直接当作成功缓存

#### Scenario: 多段与特殊写法的说明
- **WHEN** 合法 frontmatter 使用含空行的块字符串、多行引号或带引号的 description 键
- **THEN** 完整翻译 description 字符串值，保留 name 与其他字段的语义值，译文头部可正常展示

#### Scenario: 说明包含分隔文本
- **WHEN** description 字符串包含 --- 子串
- **THEN** 阅读器不把字段值截成头部结束符，正常展示元数据与正文

#### Scenario: 原始头部不可解析
- **WHEN** 原始 frontmatter 不是有效 YAML
- **THEN** 翻译整体原样保护该头部，阅读器保留其原始内容，不静默丢弃

#### Scenario: 头部起点与模型额外包装
- **WHEN** 有 frontmatter 的文档带 BOM 或前导空白，或模型在头部标记前插入非空白前言或代码包装
- **THEN** 识别并保护源头部；额外包装输出不能作为成功译文缓存，不通过保真校验

#### Scenario: 代码块内部的引用式围栏
- **WHEN** 代码块内部出现不同引用层级的围栏文本
- **THEN** 不将其当作当前代码块的关闭标记，代码内容保持保护；同层级的正确关闭标记仍生效


## ADDED Requirements

### Requirement: 流式预览容错
流式预览 MUST 容忍尚未完整输出、重复或乱序的 description 保护标记，不因标记位置触发 panic。最终输出 MUST 继续经过既有保真校验，符合既有条件时进入至多一次定向修复，不得将预览容错视作保真通过。

#### Scenario: 结束标记先于开始标记
- **WHEN** 流式内容中 description 结束标记位于开始标记之前
- **THEN** 预览不中断任务，最终校验拒绝损坏输出，既有定向修复仍可规划损坏片段
