# Verification

- Rust：`cargo test --features test-helpers --lib` 330 通过（保护/修复测试随机制删除，任务/取消/缓存/管线测试保留并全绿）；`clippy -D warnings` 干净；`cargo fmt --check` 干净。`services/translation.rs` 982→52 行，`commands/translation.rs` 删除修复分支与 Repairing 事件。
- 前端：`bun run test` 54 文件 502 用例全绿（repairing 用例删除、流式连续性用例保留）；`typecheck`、`lint`、`format:check` 通过；`translation.repairing` 与 `translation.errors.fidelity` i18n key 已移除。
- 证据链：e2e-case-lifecycle SKILL.md 在 4 个真实模型组合上 3 个确定性 fidelity 失败（54 标记全部原样出现、纯跨行语序重排被拒），修复轮复发——提案所依据的实证。
- 规格：`openspec validate direct-skill-translation --strict` 通过；归档后主 specs 同步（3 项 REMOVED、5 项 MODIFIED/ADDED）。

设计取舍：本阶段无任何译文校验（用户决策"先看效果"）；prompt 即契约；`POLICY_VERSION` 6→7 使旧缓存整体失效，避免评估时命中旧策略译文。
