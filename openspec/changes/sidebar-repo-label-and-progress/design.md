# Design

## Context

`SkillPreviewPanel` 是仓库详情页与社区技能卡片共用的预览侧边栏（无 header，调用方上下文负责标识技能）。footer 左侧为 `skillName` prop；进度条由 `loading` prop + 内部 `hadLoading` 锁存驱动，内容未加载过则不渲染。两条入口的 `loading` 来源不同：RepoDetail 仅预览查询（通常缓存命中），BrowseSkills 是仓库技能列表解析 + 预览查询两段。

## Goals / Non-Goals

- Goals: footer 标签按入口语义化（社区=仓库、详情页=技能）；进度条只在有真实加载反馈价值的入口出现。
- Non-Goals: 不改进度条动画/CSS；不改骨架屏；不加 i18n 文案；不给仓库详情页入口加仓库标签（用户已在仓库页）。

## Decisions

- 新 props 全部可选、默认保持旧行为：`repoLabel`/`onOpenRepo` 同时提供才渲染可点击仓库标签（`<button>` + `ArrowUpRight` 图标，`title={repoLabel}` 兼作截断悬停）；`showProgressBar=false` 时渲染块与 `hadLoading` 锁存一并短路，避免"进度条没了但锁存残留"。
- 跳转复用 `handleSkillSearchResult`（BrowseSkills 既有先例：`skillsApi.searchRepo` 富化 branch/stars，失败不阻塞，经 `navigateToRepo` 清搜索、记最近浏览）；点击时先 `setPreviewTarget(null)`，防止从仓库详情页返回后残留预览面板。
- BrowseSkills 接线测试用与 `App.tsx` 一致的 stateful harness（`selectedRepo` 状态切换），断言仓库详情替换发现视图且面板被卸载；不依赖 framer-motion 退场动画在 jsdom 中完成。

## Risks / Trade-offs

- `repoLabel` 模式下技能名不再显示于 footer；技能身份由卡片副标题与 SKILL.md 正文承担（用户已确认此取舍）。
- dev 与 release 的社区目录内容不同不影响：`repoLabel` 取自 `previewTarget.source`，解析前后均可用。
