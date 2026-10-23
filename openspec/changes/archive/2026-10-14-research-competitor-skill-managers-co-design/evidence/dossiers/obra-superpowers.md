# superpowers 概念级（★298.9k|Shell/内容框架|2026-10-10|MIT）

## 1. 定位与架构（概念）

一句话定位：面向 coding agent 的方法论技能库（TDD、调试、计划、代码评审等 15 个技能），不是一个管理器。研究范围限定其分发/安装协议、目录组织与版本化，不涉及技能内容本身。

- 技术栈：技能为纯 Markdown（`skills/`，15 个目录），周边是各 harness 的插件清单与少量 JS/TS 引导代码（OpenCode/Pi 的 bootstrap 注入）。
- 分发模型：**寄生于各 harness 的 plugin 机制，自己没有安装器**。仓库内维护 12 份并行插件清单：`.claude-plugin/`、`.codex-plugin/`、`.cursor-plugin/`、`.devin-plugin/`、`.hermes-plugin/`、`.kimi-plugin/`、`.antigravity-plugin/`、`.muse-plugin/`、`.opencode/`、`.pi/`、`gemini-extension.json`、`.agents/plugins/marketplace.json`，全部指向同一份 `skills/` 树（`source: "./"`）。
- 安装入口三层（README「Installation」节）：① 各家官方 marketplace（`/plugin install superpowers@claude-plugins-official`、openai plugins、xai-official）；② 自建 marketplace repo（`/plugin marketplace add obra/superpowers-marketplace`）；③ 直接 GitHub URL 安装（多数 harness 接受 repo URL）。
- 版本化：`package.json` version 7.0.0 与 12 份清单**锁步**。其实现是 `.version-bump.json` 声明 12 个文件的 version 字段，由脚本批量 bump 并审计一致性（`.version-bump.json`）；RELEASE-NOTES.md 108KB，发布节奏频繁。
- 值得注意的信号：`.agents/plugins/marketplace.json` 出现了 `interface.displayName`、`policy.installation`、`category` 等字段。这是 `.agents/` 约定从 skills 目录向 plugin marketplace 层蔓延的实证。

## 2. 功能清单（仅分发/协议维度）

- [完整] 单树多清单分发：一份 `skills/` 树，12 个 harness 清单各自描述入口，README 按 harness 分节给出互不相同的安装命令（README:52-260）。
- [完整] 版本锁步机制：`.version-bump.json` + `scripts/bump-version.sh` 保证 12 份清单版本一致，配 pre-commit 与 CI 审计。
- [完整] marketplace 元数据双形态：Claude 系 `.claude-plugin/marketplace.json` 与新式 `.agents/plugins/marketplace.json`（带 policy/category 字段）并存。
- [完整] 各 harness 兼容垫片：`hooks/`、`.pi/extensions/superpowers.ts`、`index.js`（OpenCode v2 目录形态入口）等注入 session bootstrap，绕开「harness 没有 Skill 工具」的差异（docs/porting-to-a-new-harness.md）。

## 3. 借鉴候选（90 分门槛）

### 3.1 「应用需要感知 plugin/marketplace 类来源」的结论：需要，但只需**识别**而非实现
- 是什么：superpowers 这类供给方经 harness plugin 机制安装后，技能落在各 harness 的插件缓存目录（如 `~/.claude/plugins/`），与 `~/.claude/skills/` 是两个世界；用户在 skill-zoo 的 Local 页看不到它们，重名时也不知 shadowing 存在。
- 程度：superpowers 证明这条供给管道已是主流（298.9k star 的项目完全不走 `~/.agents/skills/`）；csm 已把 plugin 列为诊断对象（见其档案）；`gh skill install` 的 `--allow-hidden-dirs` 也暗示 `.claude/skills/`/`.agents/skills/` 属隐藏目录约定。
- 为何 great：这不是功能抄袭而是生态事实。SSOT 模型若对 plugin 来源失明，「文件系统是唯一真相」就有盲区。
- 落点：桌面端扫描层增加**只读识别**：发现 harness plugin 缓存中的技能时以独立 origin（如 `plugin`）呈现为管理对象，纳入重名/shadowing 诊断，但绝不移动、不链接、不纳管。插件由 harness 自治。代价：Rust 扫描器加目录约定 + origin 枚举值，协议文档同步；与「桌面拥有本地协议」兼容（只是扩展了只读视图）。建议作为独立 OpenSpec change 评估，本期不绑定。

## 4. 明确不借鉴（带理由）

- 12 份并行清单的锁步版本化：skill-zoo 是管理器不是供给方，无需为自己发 plugin。
- marketplace 协议实现：各 harness 的 plugin 机制互不兼容且快速演化，跟进成本无底洞。
- session bootstrap 注入（hooks/扩展）：属于内容框架的运行时，越出管理器职责。
- `.agents/plugins/marketplace.json` 新字段跟进：协议未定稿，观察即可。

## 5. 借鉴裁定

ABSORB: plugin 来源的只读识别（扫描层以独立 origin 呈现 harness 插件缓存技能并纳入 shadowing 诊断，不纳管不移动）。该能力应作为独立 change 立项。

除此之外 NOTHING：其价值全部在内容侧与分发侧，skill-zoo 作为管理器既不竞争也不依赖。
