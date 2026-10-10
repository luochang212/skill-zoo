## 1. 开启开关并确认基线

- [x] 1.1 在根 `tsconfig.json` 加入 `noUncheckedIndexedAccess: true` 与 `verbatimModuleSyntax: true`，运行 `bun run typecheck`，确认报错数恰为 23（`verbatimModuleSyntax` 贡献 0）
- [x] 1.2 在 `packages/cli/tsconfig.json` 加入同样两个开关，运行 `bun run cli:typecheck`，确认报错数恰为 26
- [x] 1.3 在 `tsconfig.node.json` 加入同样两个开关，确认 `bunx tsc -p tsconfig.node.json --noEmit` 无错误

## 2. 修复前端错误（23 处）

- [x] 2.1 修复 `src/components/skills/BannerCarousel.tsx`（9 处），确认 `bun run typecheck` 中该文件报错归零
- [x] 2.2 修复 `src/components/skills/SkillHero.tsx`（4 处），确认该文件报错归零
- [x] 2.3 修复 `src/hooks/useAppUpdater.tsx`（2）、`src/hooks/useSkillIssues.ts`（1）、`src/lib/api/errors.ts`（1），确认三文件报错归零
- [x] 2.4 修复测试文件 `src/components/skills/InstalledSkills.test.tsx`（3）、`src/hooks/useSkillIssues.test.ts`（2）、`src/hooks/useRepoLoadStage.test.ts`（1），确认报错归零
- [x] 2.5 运行 `bun run typecheck` 确认 0 错误，运行 `bun run test` 确认全绿且用例数未减少

## 3. 修复 CLI 错误（26 处）

- [x] 3.1 修复 `packages/cli/src/protocol/archive.ts`（1 处，生产代码），确认改动不改变归档/恢复语义
- [x] 3.2 修复 `packages/cli/tests/imports.test.ts`（18 处），仅调整夹具构造，不放宽断言
- [x] 3.3 修复 `packages/cli/tests/scan.test.ts`（6 处）与 `packages/cli/tests/protocol-fixtures.test.ts`（1 处），不放宽断言、不改 fixture 期望
- [x] 3.4 运行 `bun run cli:typecheck` 确认 0 错误，`bun run cli:test` 全绿，`bun run cli:build` 通过

## 4. 复核与验证

- [x] 4.1 复核非空断言例外清单：列出本次新增的所有 `!` 及其依据注释，确认不存在"为通过类型检查"而批量加 `!` 的提交
- [x] 4.2 逐文件确认生产代码改动（前端 5 个 + CLI 1 个）只做了显式空值处理，未新增业务分支
- [x] 4.3 运行 `bun run lint` 与 `bun run format:check`，确认无新增 lint / 格式问题
- [x] 4.4 运行完整 pre-push 序列（`bun run typecheck`、`bun run test`、`bun run cli:typecheck`、`bun run cli:test`、`bun run cli:build`、Rust `cargo clippy` 与 `cargo test --features test-helpers`），全部通过
- [x] 4.5 运行 `openspec validate tighten-typescript-strictness --strict`，确认变更通过校验
