# Proposal: scope-skill-file-queries-by-skill

## Why

前端 React Query 的文件内容查询与失效映射存在三个问题（合并为一个 change，同一能力：查询键/失效映射的作用域一致性）：

1. **跨技能缓存串扰（#4）**：`useSkillFileContent`（src/hooks/useSkills.ts:306）与 `useSkillImageContent`（:315）的 queryKey 是 `["skills","file",path]` / `["skills","image",path]`，**不含 skillId**。两个技能都含 `README.md` 或同名图片时共用一个缓存条目：切换技能会先闪现上一个技能的文件内容（React Query 先渲染缓存数据再后台重取）；`useSaveSkillFileContent` 的 `onSuccess`（:328）按 path 失效，会错误清掉所有技能的同名文件缓存。已核实 `SkillContentPane.tsx:245,250` 的调用确以 skillId+path 传参，串扰路径成立。
2. **批量更新漏失效（#5）**：`queryInvalidation.ts:59-62` 的 `updateAllSkills` 失效清单缺 `["skills","content"]`（单技能版 `updateSkill` 有）。批量更新重写磁盘后，`useSkillContent`（staleTime 30s）最多 30s 内显示旧 SKILL.md，依赖 watcher（约 1.5s 后触发 rescanSkills）兜底。
3. **死键（#14）**：`queryInvalidation.ts:32,71` 的 `["skills","files"]` 前缀在全项目无任何查询使用（已 grep 全仓确认），是死配置；`queryInvalidation.test.ts:37` 还把它写进断言。

## What Changes

- `useSkillFileContent` / `useSkillImageContent` 的 queryKey 加入 skillId；`useSaveSkillFileContent` 的失效同步按 skillId+path。
- `updateAllSkills` 失效清单补 `["skills","content"]`。
- 删除 `["skills","files"]` 死键（两处）+ 更新 `queryInvalidation.test.ts` 断言。

## Capabilities

### New Capabilities

- `skill-file-queries`: 前端按技能隔离的文件内容查询缓存：同名文件的缓存与失效不得跨技能串扰；批量更新后内容缓存必须失效。

### Modified Capabilities

（无。）

## Impact

- 代码：`src/hooks/useSkills.ts`（两处 key + 一处失效）、`src/hooks/queryInvalidation.ts`（失效清单 + 删死键）。
- 测试：`src/hooks/useSkills.test.ts` 新增查询隔离测试；`src/hooks/queryInvalidation.test.ts` 更新断言。
