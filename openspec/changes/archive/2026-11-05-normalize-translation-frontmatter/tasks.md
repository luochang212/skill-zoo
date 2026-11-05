# Tasks

## 1. 头部语义保真

- [x] 1.1 删除正则范围回填，使用完整 YAML 对象替换 description 并序列化；通过多段、多行引号、带引号键、嵌套元数据及特殊字符回归测试，更新缓存策略版本。
- [x] 1.2 修正阅读器关闭分隔符识别和解析失败后的内容丢失；通过 MarkdownContent 回归测试。

## 2. 应用会话内后台翻译

- [x] 2.1 将翻译状态移入应用级 QueryClient，离页只解除订阅，补齐返回接续、离页完成、显式取消与注册竞态、重译隔离、同任务去重和原文选择回归测试并通过。

## 3. 集成验证

- [x] 3.1 同步主规格，运行前后端测试、类型/lint/格式检查及 OpenSpec/ADR 严格验证，记录结果。

## Verification

- `bun run test --maxWorkers=1`: 44 files, 348 tests passed. Initial default-concurrency run hit test/worker timeouts; the serial run passed without extending timeouts or changing test configuration.
- `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`: all unit, integration and doc test suites passed; two existing performance tests remain ignored by default.
- `bun run typecheck`, `bun run lint`, `bun run format:check`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: passed.
- `openspec validate --all --strict`, `adrkit validate --all`, `git diff --check`: passed.
- Regression tests were observed failing before the YAML mechanism and reader fixes, then passing after them. No real provider requests or source Skill modifications were made.
