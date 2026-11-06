## Why

第三方技能和 AI 生成的中文 Markdown 常出现 `**技术栈：**React`，严格 CommonMark 会将星号原样展示。使用维护中的解析插件改善阅读，避免要求用户修改来源文件或自写替换规则。

## What Changes

- 共享 Markdown 阅读器启用 CJK 强调及 GFM 删除线扩展，只解析、不序列化或改写文件。
- 保持现有 GFM、HTML 清洗、代码高亮和链接行为。
- 补充中文、日文、韩文与字面量边界回归测试。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-ui`: 共享 Markdown 阅读器支持 CJK 标点附近的强调与删除线。

## Impact

新增两个 remark 插件依赖及其锁文件记录；影响技能详情、预览与仓库 README 的共享阅读器。无后端、文件写入或本地协议变更。
