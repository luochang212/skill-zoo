# Design: scope-skill-file-queries-by-skill

## Context

`useSkillFileContent`/`useSkillImageContent` 的 queryKey 缺 skillId 导致跨技能串扰；`useSaveSkillFileContent` 的失效同样按 path 而非 skillId+path。`updateAllSkills` 失效清单与单技能版 `updateSkill` 不一致（缺 `["skills","content"]`）。`["skills","files"]` 是死键（全项目无查询使用）。

## Goals / Non-Goals

**Goals:**
- 文件/图片查询键与保存失效键统一为 `["skills","file",skillId,path]` / `["skills","image",skillId,path]` 形态。
- 失效映射与查询键一致：批量更新补 content；删死键。

**Non-Goals:**
- 不改其他查询键（content/fileChildren/installed 等已有 skillId 的键不动）。
- 不做缓存清理策略改动（staleTime 保持现状）。

## Decisions

1. **查询键加 skillId 在最前（skillId 在前还是 path 在前？）：** 采用 `["skills","file",skillId,path]`——skillId 在前与 `["skills","content",skillId,directory]`（useSkillContent，255-257 行）的形态一致，且使失效前缀 `["skills","file",skillId]` 天然按技能作用域。失效处同步改为 `["skills","file",skillId,path]`。
2. **`useSaveSkillFileContent` 的失效**：`onSuccess: (_, { path })` 已能拿到 skillId（mutation variables），直接构造完整 key 失效，保持精确（不清相邻技能缓存）。
3. **updateAllSkills 补 `["skills","content"]`**：与 updateSkill 对齐；`["skills","content"]` 前缀失效会覆盖 `["skills","content",skillId,directory]` 全部子键（React Query 前缀匹配），正是所需。
4. **删 `["skills","files"]`**：两处删除；`queryInvalidation.test.ts:37` 断言改为断言不含死键（而非删掉断言），防止死键回归。

## Risks / Trade-offs

- [前缀失效语义改变] → `["skills","file",skillId,path]` 的精确失效比原先 `["skills","file",path]` 的跨技能宽失效更窄，符合预期；rescanSkills 仍保留 `["skills","file"]` 前缀（全量失效，watcher 场景需要）。
- [image 查询与 file 查询共享失效前缀？] → 二者仍是独立一级键（file vs image），保存文件不影响 image 缓存，与现状一致。

## Migration Plan

无数据迁移。前端缓存纯客户端状态，热更新即生效。
