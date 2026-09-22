# Tasks: fix-agent-hide-save-failure

## 1. 归属判定（Rust）

- [x] 1.1 在 `stage_agent_symlink_removal` 的链接收集阶段实现词典法归属过滤：链接 target 基本规范化后落在 SSOT 根之下，或等于技能缓存中任一已登记 homePath，才进入待移动集合；其余（含悬空、判定不出）跳过并计数。验证：新增单测覆盖 SSOT 链接被收集、外来链接被跳过、悬空的 SSOT 前缀链接仍被收集、origin=agent 的 homePath 链接被收集
- [x] 1.2 缓存未就绪（空/不可读）时归属过滤退化为仅 SSOT 前缀，不因缓存缺失报错。验证：单测模拟空缓存，断言 SSOT 链接仍被清理、homePath 链接被保守跳过

## 2. 解耦与降级（Rust）

- [x] 2.1 重排 `update_agent_preferences`：先持久化设置，失败即原样报错且不做任何链接操作；成功后再执行尽力清理。验证：既有可见性/顺序单测全绿
- [x] 2.2 清理失败不再使命令报错：部分移动失败时用既有暂存回滚把已移链接放回原位，命令仍返回成功，返回结构体新增 `link_cleanup_failed: bool`（清理成功为 false）。验证：单测"清理失败 → 设置已保存 + 返回成功 + 链接回到原位 + 标志为 true"
- [x] 2.3 清理失败详情单行 `eprintln!` 到 stderr（含 agent、错误、涉及路径；被跳过的外来/未知链接也计数输出）。验证：单测断言 stderr 内容可用 `panic::catch_unwind` 外的方式捕获或抽出格式化函数直接断言
- [x] 2.4 删除不再需要的联合原子性代码：`commit_agent_preference_change` / `rollback_agent_preference_change` 的设置回滚职责，行为收窄后溶解或简化。验证：`cargo clippy --features test-helpers -- -D warnings` 无死代码警告
- [x] 2.5 把实验坐实的四条失败路径固化为降级行为回归测试：跨卷 rename（EXDEV）、skills 目录只读、父目录只读（暂存建不起）、链接被外部重建——全部断言"隐藏成功 + 提示标志为 true + 目录恢复原状"；跨卷用注入 rename 失败模拟即可，不必真挂卷。验证：`cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` 全绿

## 3. 前端提示

- [x] 3.1 `zh.json` / `en.json` 新增 `settings.agentPaths.hiddenWithCleanupWarning`（落地文案不带 {agent} 插值——返回值按 design 决定 3 仅携带布尔，前端无从得知具体 agent；zh「已隐藏 Coding Agent，部分技能链接未能清理」，en "Coding agent hidden, but some skill links could not be removed"）。验证：`bun run typecheck` 通过且两语言键一致
- [x] 3.2 `AgentPreferences` 类型与 `useAgentPreferences.save` 成功分支处理 `link_cleanup_failed`：为 true 时弹新增的单句状态提示，为 false 时保持现有静默行为；失败分支文案不变。验证：`bun run typecheck` 0 错误，新增/更新组件或 hook 测试断言两种分支的 toast 行为

## 4. 复核与验证

- [x] 4.1 确认协议面零变化：`fixtures/local-protocol/` 无 diff，CLI 测试 `bun run cli:test` 不需改动即全绿（可见性设置非协议面）
- [x] 4.2 对照 spec 五条 requirement 逐条核对实现与测试锚点齐全（隐藏必成、归属边界、简洁提示、无主动重试、可见性边界）
- [x] 4.3 运行完整 pre-push 序列（前端 typecheck/test、cli:typecheck/test/build、Rust clippy/test），全部通过；`bun run lint` 与 `bun run format:check` 无新增问题
- [x] 4.4 运行 `openspec validate fix-agent-hide-save-failure --strict` 通过
