# Proposal

## Why

发现页两个入口共用预览侧边栏，但底部信息与加载反馈不分场景：

1. 底部 bar 左侧恒为技能名。社区技能卡片进来的用户已经知道技能名（卡片副标题即 `owner/repo`），不知道的恰恰是技能属于哪个仓库；仓库详情页入口则技能名合理。
2. 底部 bar 上方的加载进度条对社区入口合理（需下载解析仓库技能列表），但仓库详情页内容通常已缓存，进度条瞬间跑完 + 完成动画，体验是闪一下。

已与用户确认：社区入口底部标签**换成仓库名**并可点击跳转仓库详情页；仓库详情页入口保持技能名、不显示进度条。

## What Changes

- `SkillPreviewPanel` 新增可选 `repoLabel`/`onOpenRepo`（footer 左侧渲染可点击仓库标签，替代技能名）与 `showProgressBar`（默认 true；false 时进度条及锁存不激活，骨架屏不受影响）。
- 社区面板（BrowseSkills）传 `repoLabel={previewTarget.source}`；点击先关闭预览，再复用 `handleSkillSearchResult`（searchRepo 富化失败不阻塞）跳转仓库详情页。
- 仓库详情页面板（RepoDetail）传 `showProgressBar={false}`。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-ui`: 预览侧边栏底部标签的来源语义与加载进度条的显示条件。

## Impact

- `src/components/skills/SkillPreviewPanel.tsx`、`RepoDetail.tsx`、`BrowseSkills.tsx` 及两处测试；无后端、协议、CLI 或 i18n 文案变化。
- Local 页不受影响（预览面板仅 Discover 两入口使用）。
