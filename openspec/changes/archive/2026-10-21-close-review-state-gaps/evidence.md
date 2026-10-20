# Worth-fix 核验与取舍

基线 2d75a27，复现来自上一轮验收，均将翻转为正确行为回归测试。

| 项目 | 属实与影响 | 价值判断 | 决策 |
|---|---|---|---|
| 刷新旧快照 | 已复现磁盘星标 true / 内存 false；并发刷新与写入可触发 | 一致性影响中等、局部锁顺序成本低；不修持续存在 | 修复，补齐批量修改临界区 |
| 合并目录链接 | 已复现合并成功却链接消失；外部目标文件仍在 | 用户技能可用性受损；拒绝链接的局部修改成本低 | 修复，不扩大为通用链接迁移 |
| 迟到保存 | 已复现关闭重开后旧请求清除新草稿 | 文本丢失；会话标识成本低 | 修复 |
| 同目录串草稿 | 已复现 A 草稿保存写入 B | 错写用户技能，必须隔离身份 | 修复 |
| 撤销 dirty | 已复现原文恢复但归档禁用且无保存按钮 | 常见交互、局部修复成本低 | 修复 |
| 重装 extra | 原审查仅结构确认，无当前额外字段生产者 | 影响低；保留字段为已有 ADR，卫生成本极低 | 用真实锁更新函数补实测后修复 |
| 保存测试假阳性 | 初始化 false 满足旧断言 | 降低验证可信度，改末次断言成本极低 | 修复 |

不需要全仓重构。链接保护的信任边界为用户正常合并本地技能；确定后果是链接丢失导致技能不可用，不夸大为外部文件删除或数据外传。

## 本轮实证

- 修复前，新增前端回归 5 项失败：关闭重开同技能/异技能后 dirty 被旧保存清除；同 directory 串草稿；旧辅助保存清除新草稿；还原原文上报仍为 true。修复后定向测试 16/16 通过，含补充的「保存期间撤销回旧磁盘正文」场景。
- 修复前，真实 refresh_installed_skills 并发测试显示 disk=true、memory=false；合并目录链接测试显示返回 Ok 且 SSOT 和原 agent 的 assets 均不可访问。新回归断言正确行为，修复前 2/2 失败。
- 低优先级 extra 项现已通过真实 CliService::update_lock_after_install 调用坐实：复用共同 lock-v3-full.json 样本，修复前条目 futureOptional 消失，回归 unwrap 失败；不再只是结构推断，无需真实网络安装。
- 生产修改均为局部：先锁后读；成功删除 ID 的元数据在同一临界区变更/保存；源链接先拒绝、复制遇新链接也拒绝并清理本次目标；会话代次隔离保存和懒加载回调；撤销按当前基线清草稿，在途保存保留撤销意图；安装更新继承旧 extra。
- CLI 115/115、双端 TypeScript、前端 lint/format、OpenSpec strict、ADR 校验通过。完整 Rust/前端套件在最终验证后补录。
- 一次定向前端验证在 Rust 链接资源竞争时出现原有 findByRole 的 1 秒超时；链接结束后同套 16 项通过。未提高测试超时或修改产品逻辑规避该失败。

## 验证边界

并发回归用临时家目录与真实刷新入口，通过持有元数据锁使写入/刷新交错；等待缓存落盘并留出 500ms 供刷新到达阻塞点。批量删除的单一变更/保存临界区由控制流检查和现有删除回归覆盖，无新增模拟事务框架。目录/文件软链接测试在 Unix 执行，Windows junction 依赖同一现有识别函数，本机未做 Windows 实机验证。复制时源突变的失败清理由代码控制流审查覆盖，未加仅供测试的故障注入层。

Modern Web Guidance 查询和列表未提供适用于 React 编辑会话隔离的指导，本次没有引入新浏览器 API 或更改支持下限。

## 最终验证与结果

- `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`：276 passed、2 ignored、0 failed。新增刷新并发回归断言磁盘和内存星标均为 true；目录链接回归断言拒绝合并、两份原件链接及其外部目标存活。
- `bun run test -- --maxWorkers 2`：221/221。覆盖同/不同技能关闭重开、同目录身份切换、迟到辅助保存、撤销回原文及保存期间撤销。
- `bun run cli:test`：115/115；补强既有协议 fixture 测试后 `bun run cli:test -- protocol-fixtures.test.ts`：6/6。该测试现在更新已知路径字段再验证未知字段保留，并检查真正的仓库 fixture 字节未变。
- `bun run cli:typecheck`、`bun run typecheck`、`bun run lint`、`bun run format:check`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`cargo clippy --manifest-path src-tauri/Cargo.toml --features test-helpers -- -D warnings` 均通过。
- `openspec validate --all --strict`、`adrkit validate --all`、`git diff --check` 通过。
- desktop-ui 与 local-protocol 的 MODIFIED 要求全部同步；保留既有 Purpose、无关要求及所有原有场景名称。协议形状未变，复用当前 lock-v3-full.json 作为双端输入，并由 Rust 真实安装锁更新函数验证，未新增重复 fixture。

复现命令可直接运行：`cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml --test review_state_gaps_test -- --nocapture`、`cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml --lib install_lock_update_preserves_fixture_optional_fields`、`bun run test -- lib/useEditorState.test.tsx components/skills/SkillContentPane.test.tsx`。

全部六项已修复；无证伪项、无延期项。低优先级 extra 从结构疑点升级为真实生产函数实测后完成卫生修复。所有复现场景以正确行为断言固化，无临时测试遗留。
