## 结论：修改后通过

A′ 的核心决策已落实：权威载体、兼容镜像、显式状态、双端未知字段保留均有实现；没有重新引入 E 原语或 sidecar。**但普通批量更新仍能绕过 pin/conflict 闸门，当前不能直接通过终审。**

本次按 `git diff HEAD` 与未跟踪文件评审；工作区未修改，实验均在 `/tmp`。下文区分实测、源码确认与推断。

## 必改项

### 1. [P1] 普通 update-all 绕过 pin/conflict 闸门

**源码确认，局部实验复现。**

[commands/skill.rs:1108](/Users/alex/Documents/GitHub/skill-zoo/src-tauri/src/commands/skill.rs:1108) 在 `checked_updates=None` 时调用 `update_skill_names`，进入 [services/cli.rs:308](/Users/alex/Documents/GitHub/skill-zoo/src-tauri/src/services/cli.rs:308)。该候选循环只有缺基线、URL 和仓库检查，没有 pin/conflict 检查。

后续比较函数直接采用权威载体；远端不同便生成更新，下载覆盖技能，最后双写基线。因此：

- pinned 技能可能被升级；
- conflict 技能可能被更新并静默调和冲突。

这违反“外部 pin 闸门”和“冲突不得静默更新”两个需求。现有闸门只保护单技能及带检查结果的批量路径。

`/tmp` 中精确抽取生产 `known_update_from_tree`，仅替换树查询辅助函数后，实测 pinned、conflict 输入均生成更新候选；未执行真实下载覆盖。

**修改要求：**在服务层共同候选入口补齐拒绝逻辑、显式报告原因，并覆盖普通 update-all 路径。

### 2. [P2] 新增 CLI 测试未通过类型检查

**实测。** CLI 运行时测试通过，但 `bun run typecheck` 有三处新增错误：

- [protocol-fixtures.test.ts:79](/Users/alex/Documents/GitHub/skill-zoo/packages/cli/tests/protocol-fixtures.test.ts:79)：`SkillLockEntry` 未声明 `pinnedRef`。
- 同文件第 85、111 行：`SkillLock` 强转 `Record<string, unknown>` 触发 TS2352。

**修改要求：**修正测试的类型表达或补齐必要的协议类型镜像，使 CLI typecheck 通过；无需为此改变运行时读取行为。

### 3. [P2] 不完整 source 仍可能被静默截断

**解析结果实测，检查路径源码确认。**

[lock.rs:162](/Users/alex/Documents/GitHub/skill-zoo/src-tauri/src/services/lock.rs:162) 只取 `/` 分隔后的前两段：

| 输入 | 解析结果 |
|---|---|
| `owner/` | `Some("owner"), Some("")` |
| `/repo` | `Some(""), Some("repo")` |
| `owner/repo/extra` | `Some("owner"), Some("repo")` |

而新 `invalidSource` 判断只检查 `None`。尤其第三种输入会被静默当成另一个合法归属，不能兑现“不完整或不可解析归属不得静默择一”的承诺。

**修改要求：**明确并验证共享锁 `source` 的有效语法，对无效输入保留原 source、返回 `invalidSource`，避免截断后继续检查。

### 4. [P2] 核心业务承诺缺少有效回归测试

新增测试并非恒真：删除 flatten、破坏基线 helper 会导致失败。但它们没有钉住实际 checker 和更新入口。

最明显的覆盖错位在 [protocol_fixtures_test.rs:74](/Users/alex/Documents/GitHub/skill-zoo/src-tauri/tests/protocol_fixtures_test.rs:74)：注释称“镜像剥离后正常比较”，fixture 的 `demo` 却同时带 `pinnedRef`，真实 checker 会直接跳过它。

**至少补齐：**

- 未 pinned 的 carrier-only 条目：远端变化 → `has_update=true`，旧基线不回写。
- 无基线：成功检查当次显示 missing、双写一次；第二次正常比较、不重置基线。
- pinned/conflict：检查不取远端、不自动补写；普通批量更新不改文件。
- 单技能 pinned 拒绝，以及 invalidSource 保留状态。

## Spec：4 个需求、11 个场景对照

“分类覆盖”仅指 helper/JSON 断言，不代表业务行为已验证。

| 场景 | 实现判断 | 自动测试覆盖 |
|---|---|---|
| 外部扩展经无关桌面写入保留 | flatten 成立 | 部分；Rust 仅 serde 往返，未实际修改无关条目 |
| 双端 fixture 往返 | 成立 | 有；CLI 实际读改写，Rust serde 往返 |
| 镜像剥离、载体保留 | checker 读序正确 | **只有分类覆盖，且 fixture 带 pin，覆盖错位** |
| 两载体皆缺显式状态 | 成立 | **无 checker 状态测试** |
| 降级安装仅建立一次基线 | 源码成立 | **无连续两次检查测试** |
| pinned 无基线不自动补写 | 检查候选排除成立 | **无对应行为测试** |
| ref 缺失继续默认分支 | 既有行为保持 | 有既有默认分支测试 |
| 冲突显式且不取更新 | checker 成立；普通全量更新失败 | 仅冲突分类，无阻止取远端/更新测试 |
| 不完整 source 不消失 | 缺失分支成立；解析范围不足 | **无对应行为测试** |
| 全量更新跳过 pinned | checked 分支成立；普通分支失败 | **无更新行为测试** |
| 单技能拒绝 pinned | 远端访问前拒绝 | **无拒绝及文件不变测试** |

因此，tasks 全部勾选不能代替上述行为证据，尤其 7.1、7.4 的验收强度高于当前新增自动测试。

## 语义一致性

### 一次性 `baselineMissing` 有明确依据

这点**不构成否决理由**。

Spec 明确要求无基线条目 **“for that check”** 不报告最新，同时允许成功检查建立一次基线。实现先生成当次 missing 状态，再从原始远端结果补写，下一次正常比较，二者自洽。

但当前提示仍要求“重装或更新以重建基线”，成功补写时不够准确。建议说明“本次无法确认已安装版本”，并提示重新检查；不能无条件宣称补写成功，因为写入错误目前被忽略。

### 空值契约需要补明文

[docs/local-protocol.md:53](/Users/alex/Documents/GitHub/skill-zoo/docs/local-protocol.md:53) 的措辞尚不够精确：

- 实现将缺失、`null`、`""` 基线视为未记录，符合历史空串占位的兼容需要。
- `pinnedRef=""`、`null` 均不视为 pinned，单测已明确这一选择；文档却只说“carrying `pinnedRef`”。

应将文档明确为非空 pin 标记，并写清空串基线规则，消除字面契约差异。

“从未记录过”实际只能根据当前两载体皆无有效值判断；无法证明历史从未存在。这属于 A′ 已接受的信息边界，不要求重新引入账本。

## Standards 与回归风险

- **协议 guardrails：基本满足。** docs、desktop fixtures、Rust/CLI 双端测试均已同步；不足是行为测试深度。
- **范围控制：未发现无关代码重构。** 其他 Rust 文件主要补新增字段默认值；历史研究档案改动是标记清楚的相关勘误。
- **v3-minimal：**默认空锁读取未变，隔离探针读取成功。
- **rateLimited：**原有路径保留；更具体远端错误不会被 `baselineMissing` 覆盖，`baselineState` 仍表达缺失。
- **invalidSource 消费：**沿用既有 `checkError` 通用 issue 路径，未发现旧消费方崩溃风险。
- **CLI readLock：**对象展开保留新字段，运行时往返测试有效。
- **旧桌面：**实测普通重写保留 `skillFolderHash`，但丢失 `pinnedRef` 和未知字段。源码确认旧版更新只写 `commitSha`，会制造双载体冲突。因此 design 的“回滚安全”应限定为可读及载体保留，不能暗示旧版持续写入仍保持镜像一致。
- **主 spec：**尚未合入新增需求；tasks 已明确列为归档前 follow-up，不能将当前校验通过理解为已经同步。

未跟踪文件还包含 **1,267 个 `target/` 构建产物**，提交前应排除。

## 实测范围

| 检查 | 结果 |
|---|---|
| `/tmp` 副本前端测试 | 208 通过 |
| `/tmp` 副本 CLI 测试 | 110 通过 |
| 前端 typecheck | 通过 |
| CLI typecheck | **失败，3 处新增错误** |
| OpenSpec `validate --all --strict` | 14 项通过 |
| 隔离 Rust：生产 lock 两个新增单测及边界探针 | 通过，确认上述空值、解析和旧版重写行为 |
| Rust 完整后端套件、真实远程更新、桌面端到端 | 本轮未运行 |

**通过条件：补齐普通批量闸门、修复 CLI 类型错误、完善 source 校验，并用实际行为测试锁住核心承诺；同时补明空值与旧版本写入边界。无需重开 A′ 方案决策。**