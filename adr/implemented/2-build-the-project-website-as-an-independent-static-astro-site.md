---
status: implemented
date: 2026-10-21
raised-by: human
decided-by: human
created: 2026-10-21
description: 在改动 site/ 落地页、其构建或部署工作流，或把站点所有权并入桌面端构建之前阅读。
paths:
  - site/**
  - .github/workflows/site.yml
  - .github/workflows/build.yml
---

# ADR: 2 项目网站做成独立构建的静态 Astro 站点

## Problem

项目落地页把样式、交互与重复的翻译回退塞进了同一份文档。文案更新会暴露出静态标记与浏览器端词典之间的不一致。桌面应用的 React/Tauri 构建并不拥有这个对外的内容站点。

## Decision

把公开网站放进独立构建的 `site/` Astro 包，遵循 ADR Kit 的静态站点结构。从一本双语词典生成各语言的区块组件，保留现有的视觉呈现与浏览器原生交互，通过 GitHub Pages Actions 发布静态产物。已发布版本的数据放在公开 manifest 中，由发布自动化与站点构建共同拥有，绝不用开发包的版本号。网站依赖不得进入桌面端/CLI 的运行时依赖图。

包与配置文件拥有依赖版本与路由细节；`site/README.md` 拥有命令与部署源切换流程。

## Alternatives considered

- **保留单文件 HTML**：构建成本最低，但内容所有权依旧重复，共享布局/元数据的改动仍与交互代码混在一起。
- **拆文件但不用静态生成器**：样式与脚本分开了，但本身不提供构建期的组件组合与多语言产物；自写渲染器等于重建 Astro 的必要部分。
- **复用桌面端 React 应用**：给内容站点引入了运行时 UI 机制，并把互不相关的构建与部署生命周期耦合在一起。

## Consequences

### Verification

- 中英文生产 HTML 都带本地化文案与截图，无需运行时翻译。
- 真实浏览器检查覆盖带 base 前缀的资源、旧语言链接、轮播/导航，以及平台/版本下载边界。
- 站点工作流定义了「只校验、不部署」的 PR 流程，并监听主分支 release manifest 的变化。本地 actionlint 与工作流路径检查通过；线上 Actions 部署尚未执行过。
- 视觉比对保留了既有的区块布局与产品文案；桌面端/CLI 命令保持独立。

### Trade-offs

多一个包与一套构建需要维护。依赖及其 lockfile 隔离在 `site/` 内。迁移可能破坏嵌套路由的资源，或让 release 元数据变旧；回归测试与路径过滤检查覆盖这些边界。真正上线需要按文档切换仓库的 Pages 源；本地实现不得悄悄改动线上设置。
