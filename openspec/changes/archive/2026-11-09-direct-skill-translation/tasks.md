# Tasks

## 1. Rust 服务层

- [x] 1.1 `services/translation.rs`：删除 ProtectedMarkdown、标记/修复/解析机制及其测试；重写 `system_prompt`；`POLICY_VERSION` 6→7；保留 `MAX_SOURCE_BYTES`、`cache_key`。
- [x] 1.2 `commands/translation.rs`：`run_translation` 直接流式发送原文、preview 直通；删除 Repairing 事件与修复分支；清理修复相关测试。

## 2. 前端

- [x] 2.1 `lib/api/translation.ts` 删除 repairing 事件类型；`useSkillTranslation.ts` 删除修复态处理；i18n zh/en 删除 `translation.repairing` 与 `translation.errors.fidelity`。
- [x] 2.2 更新前端测试：`useSkillTranslation.test.tsx`、`SkillContentPane.translation.test.tsx` 移除修复态用例。

## 3. 验证

- [x] 3.1 `cargo test`、`bun run test`、lint/format、typecheck 全绿；`openspec validate --strict`；同步主 specs 并归档。
