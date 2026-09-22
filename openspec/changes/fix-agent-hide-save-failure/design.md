# Design: fix-agent-hide-save-failure

## Context

现状（见 proposal.md - Why 的动机与实验证据）：`update_agent_preferences` 的执行顺序是"暂存移出链接 → 保存设置 → 删除暂存（坐实移除）"，`commit_agent_preference_change` 与 `rollback_agent_preference_change` 维持设置与链接的联合原子性；暂存阶段把 agent 技能目录里**所有**符号链接一律视为己有。仓库对实体目录已有所有权纪律（安装不覆盖、`remove_skill_dir` 不触碰、合并需同意），本设计把它延伸到符号链接。

约束：Tauri IPC 是前后端唯一桥；清理状态必须经命令返回值传递；`fixtures/local-protocol/` 与 CLI 协议不受本变更影响（可见性设置属桌面端 settings，非 lock/archive 协议面）。

## Goals / Non-Goals

**Goals:**

- 隐藏偏好的保存与链接清理解耦：设置持久化失败是唯一的失败路径。
- 清理只移动"应用拥有的链接"，外来与判定不出的链接原位保留。
- 清理失败以单句状态提示呈现，详情走 stderr。
- 顺带收缩为联合原子性服务的耦合代码。

**Non-Goals:**

- 不改显示（unhide）路径的任何行为。
- 不引入 toast 错误透传、EXDEV 回退、扫描期清扫（proposal 已否决）。
- 不重构暂存机器本身——它继续负责清理内部的批量回滚。
- 不动 lock/archive 协议、fixture 与 CLI。

## Decisions

### 决定 1：执行顺序反转为"先持久化设置，后尽力清理"

- (A) 保持原子性、逐个修复环境原因（EXDEV 回退等）——否决：枚举不完，且不解决"偏好被卫生动作劫持"的语义问题。
- (B) 先保存设置，再尽力清理，清理失败仅回滚已移动的链接——采纳。设置是契约，清理是卫生；设置持久化失败时清理尚未开始，无需任何回滚。

后果：`commit_agent_preference_change` 的"设置回滚"分支与 `rollback_agent_preference_change` 的设置恢复职责消失，函数预计溶解进命令体；暂存机器保留，职责收窄为"清理内部的部分失败回滚"（全部链接回到原位，保持可重试的整洁状态）。

### 决定 2：归属判定用词典法（SSOT 前缀 + 已知 homePath），不 canonicalize

判定"应用拥有的链接"：链接 target 字符串（基本规范化后）落在 SSOT 根（`~/.agents/skills/`）之下，或等于缓存中任一已登记技能的 homePath。

- 不 canonicalize 的原因：悬空链接（SSOT 实体已删）必须仍被识别为己方并清走，而 canonicalize 对悬空 target 直接失败。应用自建链接的 target 就是按 `~/.agents/skills/...` 字符串写的，前缀比对恰是己方链接的签名。
- 已知 homePath 取自操作时刻的技能缓存（缓存由文件系统事实重建）。缓存未就绪时退化为仅 SSOT 前缀——宁可留下己方链接（保守方向），也不冒进。
- 备选否决：只匹配 SSOT 前缀——会漏掉本地技能（origin=agent）的链接，那是对"只动己方"另一个方向的违背；查询链接创建元数据——文件系统上不存在此信息。
- 指向 SSOT 内部的外来链接在词典法下与己方不可区分——按 AGENTS.md 的 SSOT 设计，指向我方存储即入我方命名空间，接受该归类。

### 决定 3：清理状态经命令返回值携带，前端只拿布尔

`update_agent_preferences` 的返回结构体增加 `link_cleanup_failed: bool`（成功清理时省略或为 false）。前端在成功分支据其为 true 时弹单句状态提示；详情（agent、原因、路径）由 Rust 侧 `eprintln!` 单行输出到 stderr，不进入返回值——前端不需要它，风格约束也要求界面不出现 errno/路径。

- 备选否决：返回值携带完整错误串——前端拿到也只用于丢弃，且增加把细节漏进 UI 的可能；独立事件/查询通道——为一次性状态通知过度设计。

### 决定 4：文案与 i18n

新增 `settings.agentPaths.hiddenWithCleanupWarning`：zh「已隐藏 {agent}，部分技能链接未能清理」，en "Hidden {agent}, but some skill links could not be removed"。与既有 `agentPaths` 命名空间一致，单句、无变量泄漏。

## Risks / Trade-offs

- [风险] 分歧状态：隐藏成功但链接残留 → 缓解：单句状态提示明示"部分未清理"；残留物为应用自己的惰性链接；"取消隐藏→再隐藏"为幂等重试路径（spec 已入档）；stderr 留详情。
- [风险] 归属误判留下己方链接（用户改过 SSOT 布局、缓存未就绪）→ 缓解：保守方向是有意的；stderr 记录被跳过的链接数；缓存重建后重试自愈。
- [风险] 回滚到旧版本后，残留链接会让旧逻辑再次硬失败 → 与现状 bug 同害，非新增伤害；残留本身不影响技能可用性。
- [权衡] 放弃"永不分歧"不变量换取"偏好永不被劫持"——proposal 已声明为有意取舍。

## Migration Plan

无数据迁移、无协议变更，随应用版本发布即可。回滚：直接 revert——新流程写入的设置与旧格式完全一致；上一次降级清理残留的链接在旧逻辑下的行为与本修复前的 bug 相同，不产生新状态。

## Open Questions

（无。清理顺序、归属算法、返回值形状、文案粒度均已在讨论中定案。）
