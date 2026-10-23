# GenericAgent 概念级（★14.3k|Python|2026-10-14|MIT）

## 1. 定位与架构（概念）

一句话定位：自演化个人 agent。它每完成一个任务就把执行路径「结晶」为可复用记忆/技能，技能树随使用生长，种子代码仅约 3K 行。

- 技术栈：纯 Python，核心循环 `agent_loop.py` 约 100 行，9 个原子工具（code_run/file_read/file_write/file_patch/shell 等）。
- 技能形态：**没有 SKILL.md 格式、没有 manifest、没有安装概念**。技能就是 `memory/` 目录下的普通 `.md`（SOP 文档）与 `.py`（已验证的辅助脚本），由 agent 自己在任务结束时写入。
- 沉淀机制（核心研究对象）：工具 `start_long_term_update`（`ga.py:529-543`）在任务完成后触发「记忆提纯」。具体做法是注入一段 L0 元提示词，要求只保留「事实验证成功且长期有效」的知识，先读后 patch、合并重复、压缩冗述。真正的纪律在 `memory/memory_management_sop.md`（L0 公理）：**No Execution, No Memory**（只有工具调用成功结果才能写入）、已验证数据不可丢、禁存易变状态、最小充分指针。
- 分层记忆：L1 索引（`global_mem_insight.txt`，**硬约束 ≤30 行**，场景关键词→记忆定位）/ L2 事实库 / L3 技能库（memory/）/ L4 会话存档。L1 是上下文预算机制：路由信息压到 1k tokens 内，细节按需 read/ls。

## 2. 功能清单（仅技能沉淀维度）

- [完整] 任务后提纯工具：`start_long_term_update` 有防滥用门槛（`current_turn < 10` 拒绝，`ga.py:537`），防把琐碎对话写入长期记忆。
- [完整] 写入纪律 SOP：行动验证原则 + 只 patch 不 overwrite + 禁流水账（memory_management_sop.md「0. 核心公理」）。
- [完整] L1 索引预算机制：≤30 行硬约束，两层「场景关键词→定位」映射 + 红线规则。
- [半成品] Morphling 模式：从外部 repo 提取 goal+tests 决定 call/rewrite/discard（README:380），概念重实现浅。

## 3. 借鉴候选（90 分门槛）

无。逐项检验：

1. 「成功路径固化为技能」：结晶动作由 LLM 服从提示词 SOP 完成，**代码里没有机制**，既没有结构化格式、也没有校验、更没有去重保证，质量完全取决于模型自律。skill-zoo 是确定性文件管理器，没有可移植的机制层面产物。
2. L1 ≤30 行索引：属于 agent 上下文工程，skill-zoo 的对应物（csm schema 式的机器可读契约）已在 csm 档案中裁定，且那是声明式生成的，与此处「模型自己维护索引」是两条路。
3. 技能=memory 目录约定：与 Agent Skills 规范（SKILL.md frontmatter）不同源，无互操作价值。

## 4. 明确不借鉴（带理由）

- start_long_term_update：prompt 驱动的自律机制，无确定性保证，无法进入桌面端工程。
- L0-L4 记忆分层：是 agent 运行时设计，与管理器无关。
- memory/ 目录格式：私有约定，非 SKILL.md 生态。
- Morphling/Goal Hive：另一个物种的功能。

## 5. 借鉴裁定

NOTHING：预判成立。它的「技能沉淀」是提示词纪律而非代码机制，唯一价值是佐证了一个产品判断：个人 agent 的技能会以不可预测的私有形态散落，管理器的价值恰在于用 SSOT+规范格式收拢这些散落物。
