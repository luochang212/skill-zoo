# Proposal: fix-agent-hide-save-failure

## Why

Issue #10（v0.3.47 / macOS 15.8）：在"管理编程工具"中关闭 OpenClaw 时报"Coding Agent 设置保存失败"。实地实验（直接调用生产函数 `stage_agent_symlink_removal_in_dirs` + 真实文件系统，含真实挂载卷）坐实了四条失败路径：skills 目录跨卷 rename（EXDEV, os error 18）、skills 目录只读（EACCES）、父目录只读导致暂存目录建不起来（EACCES）、链接被外部进程重建后回滚撞车（"destination now exists"）。

四条路径共同指向一个语义层缺陷：`update_agent_preferences` 把"隐藏一个 agent"这个可逆的界面偏好，与"把符号链接移出该 agent 目录"的文件系统清理硬绑成原子事务。环境 IO 的任何异常都会劫持设置保存——用户连"我不想再看到这个 agent"都表达不了。

实验同时坐实一个潜伏的数据丢失缺陷：清理把 agent 目录里**所有**符号链接一律视为己有，而 OpenClaw 官方文档明确 `~/.openclaw/skills` 是它的受管目录、允许包含它自己的符号链接技能。隐藏 openclaw 一旦成功，会删掉 openclaw 自己的链接。仓库对**实体目录**早有所有权纪律（安装不覆盖、删除不触碰、合并需同意，见 `remove_skill_dir` 的契约），唯独符号链接路径漏掉了这条纪律。

此外该路径的错误通道完全缺失：前端 toast 丢弃后端错误串，GUI 无可见 stderr、无日志文件，同类报障不可诊断。

## What Changes

- **解耦偏好保存与链接清理**：`update_agent_preferences` 改为"先保存设置，清理尽力而为"。设置持久化失败仍整体报错（那是真失败）；链接清理失败不再阻断隐藏——已移的链接回滚回原位，界面提示一句简洁的状态文案（如"已隐藏 OpenClaw，部分技能链接未能清理"），不展示 errno 与路径；清理失败详情写入 stderr（从终端启动二进制可见）。
- **清理只动应用拥有的链接**：仅移动 target 指向 SSOT（`~/.agents/skills/`）或缓存中已知技能 homePath 的符号链接。外来链接与判定不出的链接一律保留不动，数量记录到 stderr。
- **不做主动重试**：清理失败后不自动补扫；"取消隐藏 → 再次隐藏"是文档化的重试路径（链接操作对已存在且指向一致的情况幂等）。
- 明确不做（已评估并否决）：错误细节进 toast（保持简洁文案风格，见 AGENTS.md）；EXDEV 跨设备回退（长尾场景，解耦后只剩"少一句警告"的价值）；扫描期 Opportunistic 清扫（留给后续变更）。

## Capabilities

### New Capabilities

- `agent-visibility`：隐藏/显示 Coding Agent 的行为契约——隐藏必须成功（除设置持久化自身失败）、清理只触碰应用拥有的链接、清理失败降级为简洁状态提示而非阻断、无主动重试。

### Modified Capabilities

（无。现有六个 spec 均不覆盖此行为：ssot-scan 只定义扫描识别边界，其"隐藏目录过滤下外部导入 symlink 不丢失"的要求不受本变更影响。）

## Impact

- 代码：
  - `src-tauri/src/commands/settings.rs` — `update_agent_preferences` 重排为"先存设置、后清理"，清理失败降级为提示；`commit_agent_preference_change` 及其回滚机器随之简化。
  - `src-tauri/src/services/skill.rs` — `stage_agent_symlink_removal` 增加链接归属过滤（SSOT 前缀 + 已知 homePath）。
  - `src/hooks/useSettings.ts` 与 i18n（`zh.json` / `en.json`）— 新增一条简洁的状态提示文案。
- 行为变化：隐藏 agent 不再可能因链接清理失败而失败；外来符号链接不再被删除；新增"部分链接未清理"的提示场景。
- 依赖：无新增。
- 验证：实验坐实的四条失败路径固化为 Rust 回归测试（降级而非报错）；归属过滤与外来链接保留各有测试锚点。
- 语义取舍（写入 spec）：放弃"永不分歧"不变量——极端环境下隐藏成功但链接残留，残留物为应用自己的惰性链接，重试路径为取消隐藏再隐藏。
