# 2026-11-18 全仓 review 的 worth-fix 分诊

来源：2026-11-18 全仓 review（后端/前端/CLI 三路深审 + 文档基线检查）。本文件对每条发现做"属实程度"与"值得修"双重判定，并记录验证边界（哪些实证、哪些结构审查）。论断转成命题、逐环节验证后，原报告有 1 条降级、2 条标注未实测。

## 验证方法与边界

- **实证（DOM 级复现测试）**：P1-1 归档批量恢复不可达。对照组（all 视图行 checkbox 选择 → "2 selected" 批量条出现）与复现组（归档视图行 checkbox 点击为空操作、`aria-checked` 恒 false、"Restore selected" 永不渲染）双双通过。复现测试为临时文件，已删除；修复时应将该场景固化为回归测试（红→绿）。
- **结构验证（代码控制流审查 + 关键行核对）**：P1-2 及全部 P2（引用行号逐条核对）；P3 抽验 3 条前提（`config.rs:353` 的 `PathBuf::from(".")` 回退、commander 15 `lib/command.js:1497` 的 `promise.then(() => fn())` 链、`imports.ts:504` 的 `assertWritableSchema`）。
- **未实测**：所有跨进程竞态（P1-2 的桌面↔CLI 并发写 lock、P3 租约端口哈希碰撞）与运行时行为（React passive wheel 的 console 告警）未构造真实并发/运行环境，机制由代码与文档化库行为支撑。

## 判定总表

| # | 发现 | 属实程度 | 值得修 | 一句话理由 |
|---|------|---------|--------|-----------|
| P1-1 | 归档批量恢复不可达（`InstalledSkills.tsx:605`） | 坐实（实证） | **立即修** | 宣传的功能 100% 不可用；一行收窄条件 + 恢复流显式 `archiveId`；不需要重构 |
| P1-2 | `write_skill_text` 绕过租约写 lock（`commands/skill.rs:1736`） | 坐实（结构验证，竞态未实测） | **立即修** | 照抄现有租约模式约 3 行；后果是 skill 静默脱管（数据损坏级）；后悔不对称成立 |
| P2 | CLI restore 缺桌面三道守卫（`archive.ts:254-305`） | 坐实 | **修，优先于后端 P2** | 注销 agent 后恢复 = 数据移到不可见位置且归档记录被消费；违反"CLI 遵从桌面语义"护栏 |
| P2 | future-version fixtures 无 Rust 侧测试 | 坐实（grep 验证） | 修（卫生级） | 下次版本升位时桌面侧拒绝行为无回归保护；一个小测试 |
| P2 | ExternalImports/archive 逐条 unknown-field 无 fixture | 坐实 | 修（与上条合并） | 同上，防 serde 结构丢字段 |
| P2 | watcher 根集合不自愈（empty-rebuild 不 restart） | 坐实 | 排队 | 触发要求启动时 SSOT 不存在且 CLI 先装；force/install/toggle 均自愈 |
| P2 | archive manifest 孤儿记录无清理路径 | 坐实（结构验证） | 排队，可先给 `doctor fix` 加清理 | 仅进程被杀窗口触发；更便宜的路径是 CLI doctor 而非桌面对账逻辑 |
| P2 | 错误形状双轨（4 处 `lease_command_error`，其余 `to_string`） | 坐实 | 修（卫生级，低成本） | 统一走 `lease_command_error`，否则前端对 `operationInProgress` 的识别半数失效 |
| P2 | `remove_skills` 漏 `unwatch_external_path` | 坐实 | 顺手修 | 一行；不修则持续无谓全量重建（下次 restart 自愈） |
| P2 | merge 范围包含隐藏 agent | 坐实，语义未定 | **待决策** | 与 AGENTS.md 文字有张力；若有意收敛需写进文档/测试名——这是产品决策不是 bug |
| P2 | `onWheel` 内 `preventDefault` 空操作（React passive） | 坐实（机制确定，告警未实测） | 修（低成本） | 拉新手势滚动链未阻断 + console 噪音；effect 手动挂 `{passive:false}` 或删掉 |
| P3 | LocalImportsDialog 定时器泄漏；useAppUpdater catch 降级 available；`imports clean` 过度断言；CLI `runCli` 缺 try/finally 保租约；裸 SyntaxError；`archivedByVersion` 格式统一；分支名 URL 编码；扫描深度上限 | 坐实（抽验 3 条） | 顺手修批次 | 全部一行级、后悔不对称成立 |
| P3 | rebuild_cache 不回滚内存；toggle cache 无锁；watcher NotifyOnly；租约端口 2 字节哈希；temp_sibling unwrap；非 UTF-8 hash 分叉；merge 崩溃备份残留；home_dir 回退 `.` | 坐实 | **不修，记录** | 低概率/有自愈/不可达/需先定失败语义；期望值不成立 |
| P3 | App.tsx 渲染期写 ref；空库过滤器文案；CLI 交互确认持租约 | 坐实 | 不修（记录取舍） | 幂等赋值风险极低；文案属产品打磨；确认期持锁有防竞态的设计张力，动之前需权衡 |
| 温床 | 三件套手工纪律、可见范围三层各自实现、双错误体系、agent 注册表双份无钉、restore 守卫无可执行规范 | 坐实 | **ADR 记录，不立即动** | 是"下一个 bug 的产地"，单点修复不解决；按 adrkit-propose 流程定取舍 |

## 文档/版本项

- site/public/version.json 停在 v0.4.12 而主包 1.0.0：需先确认 1.0.0 release 工作流是否已跑，再判定是漏更新还是时差。
- ADR 7 缺号：不修（ADR README 明确允许 git rm 误建编号，补解释的成本大于收益）。
- CSP `img-src http:`：收紧候选（`https:` 一行），动手前需确认无 http 图源依赖。

## 勘误记录

- 前端报告初判 `useConsistencyCheck` 只排除 external 是问题 → 经核调用处（`InstalledSkills.tsx:490`）已排除 plugin，组合结果正确，降级为"规则分散"的结构观察项。
- 前端报告列 `yamlName` 隐含契约为疑点 → 核实后端仅在名不一致时填 Some（`skill.rs:952-956`），行为正确，仅作契约显式化建议。
- CLI 报告称 restore 后身份复核缺失为 P2 主因之一 → 与桌面 `skill_archive.rs:719-744` 对照确认属实，无夸大。
- **CLI 报告的"unknown owning agent 应拒绝恢复"主张被证伪并撤回**：`custom-agents.test.ts` 的 "preserves native skill management and restores after the home registration is removed" 用 `skippedAgents` 钉住了既定语义——注销 home 注册后恢复应成功（文件回原位、链接跳过、经 external import 保留可见性）。实现时先加了拒绝守卫，被该测试拦下后撤回。
- **前端报告的"恢复流 id/archiveId 混用是潜在 bug"被证伪**：`ArchivedSkill.id` 按桌面构造定义即 `archive_id`（`archive.rs:49`），选择集合与清除步骤用的是同一个域，逻辑正确；修复中一度改为 `skill.id` 后核对 `RestoreArchivedSkillsResult`（元素为 `{archiveId, skill}`）发现该域不存在，已回退原实现。
- **unknown-field fixture 检查暴露真 bug 并已修复**：桌面端 `ArchivedSkill`/`ExternalImportEntry`/两个顶层结构原本没有 `extra` 保留字段，serde 静默丢弃逐条 unknown field（CLI 靠 spread 保留）。已按 lock 的既有 `#[serde(flatten)] extra` 模式补齐并更新全部构造点，`-full` fixtures 加 `futureOptional` 字段双端断言。

## 落地记录（2026-11-18 修复批次）

- P1-1：`selectionDisabled` 收窄为仅 plugin；星标/拖拽保持归档视图禁用（`starAndDragDisabled`）；恢复流 id 域维持原样（见勘误）。回归测试 "restores selected archived skills via the batch bar"。
- P1-2：`write_skill_text` 补 `acquire_local_lease`。验证边界：无 tauri test harness，命令级竞态未实测，机制由既有跨进程租约测试覆盖。
- merge 可见范围：`merge_duplicates_inner` 经 `is_visible_local_skill` 过滤（单一收口），单条目改为拒绝（`len() < 2`）。新测试 `merge_ignores_hidden_agent_copies_and_leaves_their_directories_untouched`。
- CLI restore：SKILL.md 存在性守卫 + 移动后身份复核（`scanCacheEntries` + `canonicalizeLegacySkillId`），fixture 案例 `archive-restore-guard-cases.json` 由 CLI 套件消费；桌面侧守卫的 Rust 直测仍缺（P2 遗留）。
- 卫生批次：租约错误统一 `lease_command_error`（6 处）+ merge 命令按错误类型区分；`remove_skills` 补 unwatch；future-version 拒绝的 Rust 直测；`onWheel` 改原生 `{passive:false}` 监听（hook 测试改派发真实 `WheelEvent`）；LocalImportsDialog 定时器清理；useAppUpdater 失败重查恢复 `available`；CLI runCli `finally` 兜底释放租约；`imports clean` 移除过度断言；`archivedByVersion` 统一为裸版本。
- 未做（按分诊）：watcher 根集合自愈与 doctor 清理孤儿归档（排队项）、双错误体系/温床类结构项（ADR 流程）、文档/版本项待确认 release 状态。
