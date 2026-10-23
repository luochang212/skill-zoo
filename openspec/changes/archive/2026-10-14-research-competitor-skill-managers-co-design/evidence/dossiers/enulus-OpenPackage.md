# enulus/OpenPackage(★618|TypeScript|2026-05-11|Apache-2.0)

## 1. 定位与架构(实证)

一句话定位:「coding agent 配置的包管理器」。它把 rules、commands、agents、skills、MCP、Claude plugins 当作可安装/可打包/可跨平台转换的软件包,自比「更强大的开源版 Vercel Skills + Claude Code Plugins」(README.md:56)。

技术栈:TypeScript monorepo(turbo),core 73.5k 行 + cli 5.5k 行;custom test runner(tests/ 139 个文件,非 vitest/jest);npm 包名 `opkg`。

SSOT/分发模型:**path-based source of truth,复制+转换分发**(specs/architecture.md)。三层:可变包源(`~/.openpackage/packages/` 或 `./.openpackage/packages/`,通用布局 rules/commands/agents/skills/root/AGENTS.md/mcp.jsonc)→ 不可变 registry 快照(`~/.openpackage/registry/<name>/<version>/`,目录制无 tarball)→ install 时**复制并逐平台转换**写入 `.cursor/`、`.opencode/` 等(specs/directory-layout.md;flow-executor.ts:768 `fs.writeFile`,全库无安装期 symlink)。工作区状态记于统一索引 `.openpackage/openpackage.index.yml`。因为平台目录是副本,所以必须靠 xxhash3 双哈希(workspace 侧 hash + 源侧 sourceHash,types/workspace-index.ts:28-37)驱动 push/pull/conflict 三态同步。也就是说,**整套同步机器是复制架构的必然伴生**。

形态:npm CLI(clack 交互)+ 托管 registry(openpackage.dev);技能来源:本地包/git URL/GitHub 子路径/Claude plugin marketplace。

## 2. 功能清单

- [完整] 统一包模型:openpackage.yml manifest + 四类资源目录 + root/ 杂项 + mcp.jsonc;`opkg new/add/remove` 维护包源
- [完整] 40 平台声明式流 DSL(platforms.jsonc):每平台 export(包→工作区)与 import(工作区→包)glob 流,支持 merge(deep/composite)、`$switch`/`$$targetRoot`、`map`+`$rename`、`when` 条件、fallback 兜底;用户可全局/工作区覆盖并深合并(README.md:264-268)。如 Amp 的 rules 导出为 `.agents/checks/`(platforms.jsonc:97-101)
- [完整] 格式转换安装:源格式→通用格式→目标平台格式三段转换,逐平台传 `$$platform`/`$$source` 上下文(install/strategies/conversion-strategy.ts:1-17)
- [完整] 统一索引:file mapping 记 merge 策略 + **key 级贡献追踪**(合并进 mcp.jsonc 的键,卸载时只删自己贡献的键,types/workspace-index.ts:9-38);包条目记 namespace/来源类型/installScope/marketplace 元数据(:53-88)
- [完整] sync:push/pull/bidirectional,xxhash3 判 divergence,冲突三选(workspace/source/skip),`--conflicts` 策略化、dry-run、JSON 结果(sync/sync-types.ts:12-40;sync-conflict-resolver.ts:26-52)
- [完整] lockfile:`.openpackage.lock.yml` lockfileVersion=1,包级记录(utils/lockfile-yml.ts:20-30)
- [完整] registry:`opkg pack` 产不可变版本快照,可变/不可变权限分离(架构文档)
- [半成品] 远程 registry:架构图标 FUTURE,现有发布走自有服务,生态尚小
- [摆设] `--json` 输出:`{success,data,error}` 裸信封(json-output.ts:15-31),无版本字段无错误码,劣于 asm

## 3. 借鉴候选(90 分门槛)

无。三个最强候选均倒在门槛 (b) 或 (c) 上,详见第 4 节分析。它们的伟大恰恰服务于我们已用架构消除的问题。

## 4. 明确不借鉴(带理由)

- **四类资源统一建模(数据结构参照价值如实记录)**:包=manifest+类型化资源目录,资源经 catalog/classifier/provenance/namespace 五层分发(resource-* 共 12 个文件)。数据结构本身是「若扩展资源类型」的可行参照,但吸收=产品转型:触及本地协议、SSOT 语义、冲突范围全部重写。且其 40 平台能力矩阵(README.md:221-262)反证了我们 skills-only 的正确性,因为 skills/ 是唯一每个平台都有独立每文件目录的资源类型,rules/commands/agents 支持稀疏且格式互异(Cursor rules 带独立 frontmatter、Amp 叫 checks、Copilot 是全局 instructions)。扩展资源类型反而会撞上 symlink 不可用的合并型平台。不借鉴。
- platforms.jsonc 流 DSL:工程上 great(声明式、可 schema 校验、可用户覆盖),但它解决的是「内容级跨平台转换」;skill-zoo 靠 symlink 分发,内容零转换,目录映射已在 Rust 端以更简单的 agent 表存在。杀鸡用不上牛刀。
- 双哈希 divergence 追踪 + sync push/pull/conflict:整个子系统治理「副本漂移」,SSOT+symlink 使漂移物理上不可能(origin 二分 + 链接指向真相)。想法好,但为我们不存在的病吃药。
- key 级合并卸载追踪:仅合并安装(mcp.jsonc deep-merge)需要;skill-zoo 无合并类安装。
- 可变/不可变 registry 双层:概念干净,但 skill-zoo 远程安装已 copy 进 SSOT(等同唯一 snapshot),再加版本快照层是重复治理。
- 裸 JSON 信封:被 asm 的版本化信封全面取代。
- 73.5k 行 core/5.5k cli 的体量比、自研 test runner:反面教材。原因在于资源类型×平台矩阵的组合爆炸是这个架构的固有成本。

## 5. 借鉴裁定

NOTHING: 它最精巧的子系统(格式转换、双哈希同步、key 级合并卸载)全部是复制分发架构的伴生成本;skill-zoo 的 SSOT+symlink 从根上消除了这一类问题,而其 40 平台矩阵以实证支持我们 skills-only 的范围选择。读它的最大价值是确认「不该走哪条路」。
