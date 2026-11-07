# 合并流程改造笔记

- 按用户要求聚焦代码，正式 OpenSpec/协议文档留给后续 Agent 补充。本轮不改存储字段或版本。
- 已复现旧实现的问题：阻塞 skills-cache.json.tmp 后，合并返回失败，但 agent 原目录已被删除并替换为链接。
- 合并移到 services/skill/merge.rs；生产入口自行持有 lease、refresh mutex 和退出保护，IPC 只委托。未加锁的原接口只留在 test/test-helpers 构建。
- 原目录和待重定向链接先同文件系统暂存，缓存与元数据均保存成功才清理。失败恢复原件、链接和内存/磁盘快照；无法恢复时保留备份并返回位置。
- 改为按参与合并的 ID 清缓存，保留 external/plugin 同名条目；原有跨 agent 链接重定向至 SSOT。来源核验实际 owner/root、SKILL.md、实时内容和 imports，拒绝过期归属。
- 新增 merge_recovery_test：缓存/元数据写入失败、原有链接与其他 owner 保留、refresh 等待取消、嵌套 skill 的外来目录链接冲突。
- ADR 1/4 保持有效；未添加依赖或通用事务框架。导入流程本轮未改。无新增崩溃/断电原子性承诺；外部工具不遵守 lease 仍可竞态。
- 行为变化供后续补规格：链接创建失败不再只打日志并继续成功，而是回滚；临时备份使用既有扫描排除前缀 .<name>.backup.。清理已提交备份失败仍记录日志，不回滚已提交数据。
- 定向验证：新增 5 项集成测试通过；另有 1 项单元测试确认恢复位置被外部重建时保留原件备份并返回位置。最初红灯证据在 /tmp/skill-zoo-merge-red.log（临时日志，不作长期文档）。
- 完成验证：Rust 全量测试通过（本轮全量含 402 项通过、3 项既有忽略）；最新 5 项合并集成测试及新增备份保留单元测试另行通过。Clippy -D warnings、cargo fmt --check、git diff --check 通过。未重跑无代码改动的前端/CLI，未做跨平台实机或崩溃注入。
