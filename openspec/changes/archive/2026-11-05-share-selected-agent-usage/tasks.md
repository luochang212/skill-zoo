# Tasks

## 1. 共享数据与采集错误

- [x] 1.1 实现按 agent 隔离的共享缓存与扫描去重，验证并发、独立来源、失败保留旧结果和重试。
- [x] 1.2 区分缺失存储和读取失败，保持坏记录容错，通过采集器回归测试。

## 2. 展示与切换

- [x] 2.1 保存选择后同步托盘来源；失败回滚；菜单显示来源与加载/空/错误状态，事件及周期后台刷新。
- [x] 2.2 图表区分加载、错误与空记录，支持重试及失败保留旧结果；通过选择保存失败和迟到结果隔离测试。

## 3. 验证与收尾

- [x] 3.1 通过完整前后端测试、类型/lint/格式、OpenSpec 与 ADR 验证，记录原生托盘验证边界并同步归档。

## Verification

- `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`: final full backend run passed (307 unit tests passed, 1 performance test ignored; integration and doc suites passed, with another existing performance test ignored).
- `cargo test --lib --features test-helpers --manifest-path src-tauri/Cargo.toml skill_usage_cache`: final 4 cache tests passed, including runtime source-selection fallback alignment.
- `cargo test --lib --features test-helpers --manifest-path src-tauri/Cargo.toml skill_usage`: 35 passed before the additional selection-fallback test, including concurrent success/error deduplication, independent agents, failed-refresh retention/recovery, and missing versus unreadable stores.
- Frontend full run before the snapshot-envelope refinement: 44 files / 351 tests passed. Final full run: 344 passed, 3 failures after long timeouts, plus a worker startup timeout. The affected CustomAgentEditor, RepoDetail and useEditorState files were rerun in isolation: 23 passed. No timeout thresholds or unrelated implementation were changed.
- Final related SkillCompanionSettings tests: 19 passed, including persisted-selection failure, read failure/retry, late-agent-result isolation and first-open display of backend cached data with a read error.
- Typecheck, frontend lint/format, Rust fmt and the project’s standard clippy command, OpenSpec strict validation, ADR validation and diff whitespace checks passed. The additional `cargo clippy --tests ... -- -D warnings` check fails on existing test-only lint warnings (including agents/settings tests and protocol fixtures); those unrelated tests were not changed for lint cleanup.
- Native tray events and menu updates were verified by code/API review and compilation, not cross-platform desktop interaction. Linux has no TrayIconEvent; periodic refresh is implemented as a fallback. Native timing is best-effort, not realtime.
- Existing settings key and on-disk schemas are unchanged. The private usage IPC now returns a typed usage/error snapshot; both callers and mocks were updated.
