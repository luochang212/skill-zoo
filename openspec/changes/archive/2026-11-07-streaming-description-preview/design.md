## Context

ProtectedMarkdown 将 description 放在同一请求的正文前。preview 会隐藏该标记区间并恢复源 YAML，restore 才重建翻译 YAML。

## Goals / Non-Goals

及时显示已有译文，不增加请求、不改变最终验证或处理不完整值。

## Decisions

复用最终恢复的 description YAML 序列化逻辑。预览仅在完整、唯一且有序的边界与非空值出现时替换 frontmatter 占位符，其他情况继续恢复原文。保留既有标记隐藏行为。

## Risks / Trade-offs

预览不是成功结果；之后若正文保真失败仍按现有错误处理。重译保留旧成功结果的前端策略不变。

## Migration Plan

无迁移。

## Open Questions

无。
