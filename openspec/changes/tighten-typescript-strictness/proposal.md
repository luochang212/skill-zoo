# Proposal: tighten-typescript-strictness

## Why

Skill Zoo 的三个 TypeScript 项目（前端 `src/`、CLI `packages/cli/`、Vite 配置）都只开了 `strict`，但都没有开 `noUncheckedIndexedAccess`，因此 `arr[0]`、`map[key]`、`path.split("/")[1]` 这类访问的结果被直接当作非空类型使用。而本项目的核心逻辑恰好全是索引访问：路径解析、目录扫描、按名字分组、按 id 查表。

实测开启该开关后立刻暴露 **49 处**：前端 23 处（8 个文件）、CLI 26 处（4 个文件）。它们集中在索引密集处，说明不是理论风险，而是既有代码里真实存在的 `undefined` 未处理路径——运行时只会在更远的地方以更难定位的形态失败。

> 实施后勘误：逐处复核证实这 49 处在运行时**全部安全**——18 处生产代码或由构造保证（长度守卫、三元真值判断），或已有运行时兜底（`Number.isFinite`、真值检查）；31 处测试由 `toHaveLength` 兜底。因此本变更修复的是类型层债务而非存量 bug，零行为变化；其价值在于为未来代码建立编译期闸门，同时 49 处存量也实证了"靠 review 人工注意"的防线未能阻止该模式累积。

同时实测 `verbatimModuleSyntax` 在三个项目上均为 **0 错误**，可以零成本一并开启，用于固定类型导入与值导入的写法。

现在做的理由：它是纯编译期改动，不依赖任何其它决策，也不需要新增验证闸门（CI 与 pre-push 已在跑 typecheck）；越早做，后续新增代码的存量成本越低。

## What Changes

- 三个 TypeScript 项目开启 `noUncheckedIndexedAccess`：根 `tsconfig.json`（前端 `src/`，101 个文件）、`packages/cli/tsconfig.json`（19 个文件）、`tsconfig.node.json`（`vite.config.ts`）。
- 三者同时开启 `verbatimModuleSyntax`（实测 0 错误）。
- 修复开启后暴露的 49 处错误，其中生产代码 18 处、测试代码 31 处：
  - 前端生产：`BannerCarousel.tsx`(9)、`lib/agents.ts`(4，即 `SkillHero.tsx` 所报 4 处的根源 `getAgentColor`)、`useAppUpdater.tsx`(2)、`useSkillIssues.ts`(1)、`lib/api/errors.ts`(1)
  - 前端测试：`InstalledSkills.test.tsx`(3)、`useSkillIssues.test.ts`(2)、`useRepoLoadStage.test.ts`(1)
  - CLI 生产：`packages/cli/src/protocol/archive.ts`(1)
  - CLI 测试：`imports.test.ts`(18)、`scan.test.ts`(6)、`protocol-fixtures.test.ts`(1)
- **不改变任何可观察行为**：不涉及 Rust、协议、fixture 期望、CLI 输出与 UI 交互；修复只是把既有的隐式 `undefined` 假设改写为编译期可验证的形式。

## Capabilities

### New Capabilities

（无。）

本变更是工具链/编译配置，不改变系统可观察行为。按 spec-driven 规则，在变更的 `.openspec.yaml` 设置 `skip_specs: true`，而不是为满足校验去发明 requirement。

### Modified Capabilities

（无。现有 `ssot-scan` / `skill-installation` / `skill-archiving` / `skill-file-queries` / `repo-zip-download` / `desktop-ui` 的 requirement 均不变。）

## Impact

- 配置：`tsconfig.json`、`packages/cli/tsconfig.json`、`tsconfig.node.json`。
- 代码（仅类型层修复，12 个文件）：见 What Changes 清单。
- 依赖：无新增。明确不把 `!`（非空断言）作为批量手段，例外见 design.md 决定 3。
- 验证入口不新增：`.githooks/pre-push` 与 `.github/workflows/build.yml` 已运行 `typecheck` / `test` / `cli:typecheck` / `cli:test` / `cli:build`，无需改 CI。
- Rust 侧零改动。
