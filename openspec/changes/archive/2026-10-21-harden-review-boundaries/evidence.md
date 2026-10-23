# Worth-fix 核验与决策

基线 aee32c9。原始审查 13 项。S1/S2 删除文件风险高、触发仅需正常操作遇同名目标，局部修复成本低，立即修。S3/S4 元数据丢失、S5/S6 草稿丢失同样值得修；S4 需统一既有写者的读取时机而非新增状态架构。S7/S8 状态倒退和焦点缺陷局部修复。D1 在用户指定 main 为工作主线后前提改变：CI 已覆盖 main，修文档而不扩 CI。D2/D3/D5 为低成本明确行为/文案修复。D4 未发现当前额外字段生产者，但保留未知数据是既有 ADR 要求，以低成本卫生修复补齐，不增加外部兼容路径。

原审查复现均调用真实生产函数，记录在 /tmp/skill-zoo-review-aee32c9/；本次把这些场景翻转为期望正确行为的永久回归测试。

# 逐项验证证据

## S1 CLI 导入删除用户目录

修复：`createAgentLink` 先 `assertAgentLinkAvailable`（实体目录与异目标链接拒绝、同目标幂等），导入预检所有目标 agent 目录，失败回滚本次已建链接；`doctor fix` 改走显式 `replaceAgentLink`（仅替换已验证为链接的路径）。
回归：`packages/cli/tests/imports.test.ts` `import collision safety` 用例验证同名实体目录导入被拒、目录内容不变、无登记、无链接产生。`diagnostics.test.ts` `fixDoctor` 验证无效链接仍可修复。实证边界：替换路径的实体目录保护由 `replaceAgentLink` 前置 `isSymlinkOrJunction` 验证，未在真实用户目录实测破坏性场景（与原审查一致，测试均用临时目录）。

## S2/S3 合并删除原件与丢标记

修复：`merge_duplicates_to_ssot` 先验证各源哈希与目标可用性（无效目标拒绝于任何删除之前），复制后验证目标哈希，再删原件；元数据先移除旧键再写合并键。
回归：`src-tauri/tests/review_boundaries_test.rs` `test_merge_rejects_invalid_destination_without_deleting_originals`（两原件 valuable.txt 存活）、`test_merge_existing_ssot_preserves_metadata`（星标与 isMine 存活）。

## S4 桌面旧内存覆盖 CLI 元数据

修复：`AppState::acquire_local_lease`（共享租约 + 磁盘重载元数据）替换所有整表写命令的裸 `AgentLease::acquire`；`rebuild_cache` 与 `refresh_installed_skills` 在提交缓存后从磁盘重载元数据（design 的"刷新从磁盘重载"）。
回归：`review_boundaries_test.rs` `test_desktop_lease_write_preserves_metadata_committed_by_cli`（完整复现原审查时序）、`services/skill.rs` 单测 `reload_metadata_pulls_disk_state_into_memory`。既有 agent 生命周期测试的 setup 补 `metadata.save()`（生产命令均即时落盘，未持久化的内存标记本就该被磁盘权威丢弃）。实证边界：spawn_blocking 扫描不继承测试家目录 thread-local，为不扩大既有隔离边界，刷新重载以单测 + 写路径集成测试覆盖，未做跨进程端到端实测。

## S5 保存期间输入被覆盖

修复：`useEditorState` 以 `contentRef` 记录最新编辑，保存成功仅在内容仍等于提交修订时清除 dirty。
回归：`src/lib/useEditorState.test.tsx` 验证在途输入保留（dirty 保持、内容为 B）；无新输入正常收尾。

## S6 辅助文件切换丢草稿

修复：`SkillContentPane` 草稿按文件管理（`fileDrafts`），移除切换即清空；保存成功仅清除提交修订的条目；未保存草稿经 `onUnsavedDraftsChange` 上报父级，并入切换确认（`useEditorState(externalUnsaved)`）、关闭确认（新增 pendingClose 对话框，`unsavedDialog.closeDescription`）与归档禁用。
回归：`SkillContentPane.test.tsx` 验证 README 草稿在切换往返后保留并上报；保存后上报清除；`useEditorState.test.tsx` 验证外部未保存触发切换确认。实证边界：归档禁用路径由 `archiveDisabled={editor.dirty || auxDraftsDirty}` 与既有 dirtyHint 文案承接，未新增独立组件测试。

## S7 启动检查覆盖已下载状态

修复：`useAppUpdater` 引入请求代次 `requestGenRef`。启动检查、手动检查、下载各自开跑时递增，结果仅在最当代次时应用；启动检查不再旁路协调。
回归：`useAppUpdater.test.tsx` `does not let a late startup check regress a completed download` 用例验证手动流程到 readyToRestart 后，迟到的启动检查返回 null 不重置状态与版本。

## S8 收起侧栏仍可聚焦

修复：文件侧栏容器收起时置 `inert`（Safari 15.5+/Chromium 102+，高于 Safari 16.4 下限）；经切换按钮收起且焦点在树内时，焦点移回开关。
回归：`SkillContentPane.test.tsx` 验证收起后容器带 `inert`、展开时无。实证边界：jsdom 不执行 inert 语义，测试钉住浏览器契约属性；原生读屏未测（与原审查一致）。

## D1-D5 文档与契约

D1：AGENTS.md Branch Canonicality 更新为 main 即开发主线（CI 已覆盖 push/PR），own-protocol 已并回、实验分支仅参考。
D2：两份 README `doctor --fix` → `doctor fix`（与 `cli.ts` 子命令一致，脚本化可用 `doctor fix --yes`）。
D3：`docs/index.html` 版本未知时资产 URL 回退到 Releases 列表页、文件名不再伪造 v0.0.0、无版本不自动下载。实证边界：静态控制流确认，未对线上版本端点做故障注入（与原审查一致）。
D4：Rust `SkillLock`/`SkillLockEntry` 增加 `#[serde(flatten)] extra`；共同 fixture `lock-v3-full.json` 加入根级与条目级未知字段；Rust fixture 测试断言解析保留，CLI `protocol-fixtures.test.ts` 断言读-写-读往返保留且源 fixture 不被改写；`docs/local-protocol.md` Compatibility Rules 增补保留义务。
D5：两份 README 网络说明如实列出应用更新检查（缓存更新存在时启动一次、设置页每日至多一次，与 `useAppUpdater`/`AppUpdateShortcut` 行为一致）。

## 全套验证

Rust 222 lib + 集成套件全过（1 ignored，与基线一致；2 个 agent 生命周期测试因 setup 未落盘而修复，属新契约的正确行为）。CLI 115 项全过，typecheck 过。前端 215 项全过，typecheck、lint、`oxfmt --check` 过；`cargo fmt --check` 过；`openspec validate --all --strict` 12/12；`adrkit validate --all` OK。CLI src 的 oxlint 报错为既有状态（HEAD 上 103 个、模式相同），CI lint 范围仅根 `src/`；新增的少量 no-await-in-loop 与周边写法一致且顺序为语义所需（预检先于任何变更、链接创建顺序确定），未改动。
