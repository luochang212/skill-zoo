# Tasks: scope-skill-file-queries-by-skill

## 1. 测试先行（红）

- [x] 1.1 `src/hooks/useSkills.test.ts` 新增测试（红）：同一 QueryClient 下渲染 `useSkillFileContent("skill-a","README.md")` 与 `useSkillFileContent("skill-b","README.md")`，断言二者查询键不同（修复前共享键 → 红）
- [x] 1.2 `src/hooks/queryInvalidation.test.ts` 更新断言：`rescanSkills` 断言移除 `["skills","files"]`、新增"不含死键"遍历断言；`updateAllSkills` 断言包含 `["skills","content"]`（修复前红）

## 2. 实现（绿）

- [x] 2.1 `useSkills.ts:306,315`：queryKey 加入 skillId（`["skills","file",skillId,path]` / `["skills","image",skillId,path]`）
- [x] 2.2 `useSkills.ts:328`：`useSaveSkillFileContent` 失效改为 `["skills","file",skillId,path]`
- [x] 2.3 `queryInvalidation.ts`：删除 `["skills","files"]` 死键两处；`updateAllSkills` 补 `["skills","content"]`
- [x] 2.4 运行 `bun run test`（src 目录），全部转绿（136 passed）

## 3. 验证与收尾

- [x] 3.1 `bun run lint` 干净（0 warnings / 0 errors）
- [x] 3.2 `openspec validate scope-skill-file-queries-by-skill --strict` 通过
