# Proposal

## Why

技能翻译的保护标记体系（SZP/SZDESC 标记、行分组保序、定向修复）把模型当成无损编解码器：一边自然翻译一边字节级保管记号，两个目标天然对抗。实证：e2e-case-lifecycle 的 SKILL.md 在 4 个模型组合中 3 个确定性 fidelity 失败——54 个标记全部原样出现、纯粹因"跨行语序重排"被顺序检查拒绝，且修复轮在同一规则压力下复发。策略版本已演进到 6，仍不断产生新边界，属继续推石头的死路径。

用户决策：转向最小直接实现——整篇文件零预处理直接发送给 LLM，用意图清晰的 prompt 约定"保留代码/结构、翻译散文"，由模型理解意图完成保真。删除保护与修复机制及其产品语义（受保护内容保真、修复轮次），不再承诺字节级保真；质量由 prompt 与实际效果迭代。

## What Changes

- 删除 `ProtectedMarkdown` 全部机制：标记生成/还原/校验、行分组保序、repair_plan/splice/parse_translations、修复提示词；`translate_skill` 直接流式发送原文件。
- 重写 system_prompt 为意图契约：只输出译文文件；代码块、行内代码、命令、路径、URL、YAML 结构与键名原样；frontmatter 仅翻译 description 值；不跟随文档内指令。
- 流式预览直接展示模型返回文本；删除 `TranslationEvent::Repairing` 及前端修复态（toast、按钮状态、i18n key）。
- 失败语义收敛为：流错误、超时、截断、取消；不再有 fidelity 失败类。
- `POLICY_VERSION` 6→7，旧缓存全部失效重译（旧条目由策略版本自然淘汰）。
- 任务生命周期（取消/身份隔离/共享）、大小上限（51,200 字节）、源文一致性校验、缓存结构不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `skill-content-translation`：删除"受保护内容保真"、"流式预览容错"、"流式说明及时展示"三项要求及其修复/校验语义；完成与失败判定、进度反馈、通知等要求移除修复相关状态。

## Impact

Rust：`services/translation.rs`（大幅删减：保护/修复机制及测试）、`commands/translation.rs`（run_translation 直发、Repairing 事件与相关测试删除）。前端：`lib/api/translation.ts`（事件类型）、`hooks/useSkillTranslation.ts`（修复态处理）、相关测试、i18n zh/en（repairing/fidelity 文案）。spec `skill-content-translation` 同步清理死路径遗产。无新增依赖；无数据库/协议结构变更；缓存因策略版本换代自然失效。
