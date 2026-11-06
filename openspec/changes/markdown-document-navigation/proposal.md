## Why

Markdown 链接目前统一交给系统 URL 打开，技能内 references 文档无法在阅读器中继续阅读，仓库相对文件被误转为 raw 下载地址。

## What Changes

- 发现页仅显示预览，禁用链接导航。
- 本地详情复用现有文件预览与路径边界，联动文件树展开和选中，不添加文档返回按钮。
- 仓库 README 的文件和标题链接指向 GitHub 页面，在浏览器打开。
- 分离图片 URL 和文档链接，支持标题锚点并限制可打开协议。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-ui`: Markdown 链接按阅读上下文导航。

## Impact

共享 Markdown 组件、技能详情与仓库预览。无新增依赖、Rust 命令或持久化协议变化。
