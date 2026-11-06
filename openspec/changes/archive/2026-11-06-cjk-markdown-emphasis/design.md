## Context

`MarkdownContent` 已使用 react-markdown、remark-gfm 和 rehype-sanitize。候选插件在现有渲染链中已验证截图案例、652 个 CommonMark 样例和现有 15 项组件测试；隔离打包估算增加约 7KB gzip。

## Goals / Non-Goals

改进 CJK 内容展示。保持来源字节、清洗边界和其他阅读器行为。不开关化，不修复所有不规范 Markdown，不增加自定义解析器或持久状态。

## Decisions

在 remark-gfm 后注册 remark-cjk-friendly 和 remark-cjk-friendly-gfm-strikethrough 的 `/parseOnly` 入口。前者处理强调，后者保持删除线的一致性；只解析入口避免引入不需要的序列化功能。现有 rehype 插件顺序不变。

## Risks / Trade-offs

CJK 及部分符号的强调结果会与严格 CommonMark 不同。这是有意的展示扩展，既不声明原文符合严格 CommonMark，也不改写原文件。空白边界错误、代码与转义不应被修复。浏览器兼容仍以 Safari 16.4 为下限，需检查构建与浏览器运行。

## Migration Plan

无数据迁移。移除两个插件即可回退展示行为。
