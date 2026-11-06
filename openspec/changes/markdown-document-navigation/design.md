## Context

技能详情已有惰性文件树、文本/图片查询、草稿保存与系统打开入口。后端 ManagedSkill.existing_path 校验 canonical 路径，拒绝符号链接越界。仓库 README 只返回文本，仓库 ZIP 已有缓存。

## Goals / Non-Goals

支持上下文内阅读与文件树定位，保留 Markdown 语义与现有样式。发现页不导航。不增加写入、下载管理或通用文件管理器。

## Decisions

共享纯路径解析器按当前文档解析链接，前端拒绝明显越界，Rust 继续拥有本地最终访问边界。允许 HTTP/HTTPS/mailto，其他协议不执行。标题 ID 在清洗之后由受控插件生成。图片 URL 单独解析。

本地导航复用现有文件查询和草稿。文件树按选中文件自动展开父目录，并通过惰性查询逐层加载，不设置文档返回栈；用户仍可手动收起目录。仓库 README 的相对文件和锚点通过标准 URL 解析到 GitHub 页面，所有允许的链接交给系统打开。

## Risks / Trade-offs

仓库 README 初始路径按根 README 处理，与 ZIP 根 README 缓存一致。仓库 README 不新增目标文件读取。标题标识覆盖中英文、格式文本和重名，复杂 GitHub 标点规则不承诺完全相同。

## Migration Plan

无数据迁移。

## Open Questions

无。
