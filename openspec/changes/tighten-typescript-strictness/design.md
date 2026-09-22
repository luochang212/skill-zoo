## Context

仓库有**三个**独立 TypeScript 项目，各自持有 tsconfig，且都已被既有闸门覆盖：

| 项目 | tsconfig | 文件数 | 开启 `noUncheckedIndexedAccess` 暴露的错误 | `verbatimModuleSyntax` |
| --- | --- | ---: | ---: | ---: |
| 前端 | `tsconfig.json` | 101 | 23（生产 17 / 测试 6） | 0 |
| CLI | `packages/cli/tsconfig.json` | 19 | 26（生产 1 / 测试 25） | 0 |
| Vite 配置 | `tsconfig.node.json` | 1 | 0 | 0 |

三者都已经有 `strict`、`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`，缺的正是索引访问的空值约束。闸门方面：`build.yml` 的 `test-frontend` / `test-cli` 与 `.githooks/pre-push` 都已运行 `typecheck`、`test`、`cli:typecheck`、`cli:test`、`cli:build`，因此打开开关即自动获得回归护栏，无需新增检查步骤。

动机见 proposal.md - Why。

## Goals / Non-Goals

**Goals:**
- 三个 TS 项目都开启 `noUncheckedIndexedAccess` 与 `verbatimModuleSyntax`。
- 修复全部暴露错误，**不改变任何运行时行为**、不新增依赖。
- 开关由既有 CI / pre-push 闸门覆盖，无法被无声关闭。

**Non-Goals:**
- 不顺手开启其它严格项（`exactOptionalPropertyTypes`、`noImplicitOverride` 等）。一次只动一个变量，便于定位回归来源。
- 不重构索引密集的既有逻辑（扫描器、`makeSkillId`、路径处理）。那些是独立议题；本次只做满足类型检查所需的最小改动。
- 不触碰 Rust、协议、fixtures 期望、CLI 输出格式、UI 交互。
- 不把 `!`（非空断言）作为批量消音手段。

## Decisions

### 决定 1：用编译器开关，而不是"review 时人工注意"

- (A) 保持关闭、靠 code review 要求 —— 否决。实测存量已有 49 处，说明人工要求已经失效，且没有可执行的回归护栏。
- (B) 只在前端开启、CLI 不动 —— 否决。CLI 的 26 处里包含 1 处生产代码（`packages/cli/src/protocol/archive.ts`），且 CLI 与前端面向同一套路径与协议语义，只开一半会让同类问题在 CLI 继续累积。
- (C) 用 lint 规则替代 —— 未采用。会引入第二套与 `typecheck` 并行的机制；oxlint 是否有类型感知的等价规则需单独评估，不混入本次范围。

结论：TS 编译器是类型层面唯一的权威判断者，开关落在既有的 `typecheck` 闸门上，一处生效、一处失败。

### 决定 2：一并开启 `verbatimModuleSyntax`

三个项目实测 0 错误，属于零成本收紧；它要求类型导入与值导入在写法上可区分，方向与两项目已有的 `isolatedModules` 一致。备选是本次只开 `noUncheckedIndexedAccess`，但那样以后还要再触碰同样的三个文件；合并处理成本更低。

### 决定 3：修复手法——表达真实约束，而不是断言

`AGENTS.md` 要求 "Solve with minimal code… Don't add error handling for scenarios that can't happen"。因此修复不是无脑加守卫，按优先级：

1. 用能表达约束、且不增加运行时代价的写法：解构默认值、`.at()`/`find` 后的显式判断、`for...of`、先判长度再取首项。
2. 若非空由构造保证（例如固定长度的 `split` 结果），用**显式守卫**把该前提写出来，而不是 `!`。
3. 仅当既无法廉价表达、又确实由构造保证时，才允许 `!`，且必须在代码旁用中文注释写明依据（与 `AGENTS.md` 的注释要求一致），并进入"例外清单"由任务复核。

明确否决：把 `x[i]` 批量改成 `x[i]!`。那只是把编译器的警告静默掉，不提供任何证据。

### 决定 4：测试错误占多数（31/49），修复不得改变被测语义

CLI 的 25 处测试错误集中在 `tests/imports.test.ts`(18) 与 `tests/scan.test.ts`(6)，属构造夹具时的索引访问。修复只允许改动"如何构造/读取夹具"，不允许放宽断言、跳过场景或改变期望值。判定标准：`bun run test` 与 `bun run cli:test` 全绿，且用例数不减少。

### 决定 5：`tsconfig.node.json` 一并对齐

虽然只覆盖 `vite.config.ts` 一个文件、当前 0 错误，但它是第三个 TS 项目；漏掉它会留下"哪个项目开过、哪个没开"的认知负担，而开启成本为 0。

## Risks / Trade-offs

- [风险] 为消除类型错误而引入运行时分支，改变行为 → 缓解：以 `bun run test`、`bun run cli:test`、`cargo test --features test-helpers` 作为回归护栏；源文件改动须逐条确认"是否触及运行时路径"。
- [风险] 用 `!` 批量消音，形式达标但无保障 → 缓解：决定 3 的例外清单 + 中文注释，任务中逐条复核。
- [风险] 打开开关会降低未来写索引代码的速度（每处都要处理 `undefined`）→ 这是有意的取舍：把不确定性从运行时前移到编译期。
- [风险] `verbatimModuleSyntax` 与将来某个依赖的类型导出风格冲突 → 当前三项目 0 错误；未来新增依赖触发时按报错修正导入写法，属正常维护成本。
- [权衡] 不开启其它严格项，严格性只提升一格 → 有意为之，便于把回归归因到本次改动。

## Migration Plan

无部署、无协议、无数据迁移。纯编译期配置 + 类型层修复。

回滚：移除三个 tsconfig 中的两个开关即可回到当前状态；修复后的代码本身是显式的空值处理，与回滚后的行为等价，无需一并回滚。

## Open Questions

（无。三个项目的错误数、`verbatimModuleSyntax` 的成本、`tsconfig.node.json` 的处理均已实测确定。）
