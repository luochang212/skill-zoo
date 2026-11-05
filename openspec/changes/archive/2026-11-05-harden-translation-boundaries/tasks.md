# Tasks

## 1. 核验与修复

- [x] 1.1 复核四项报告的真实性、影响、概率与成本，保留四个先红后绿的生产函数回归测试。
- [x] 1.2 局部修复预览范围、围栏引用上下文及头部边界，升级缓存版本，通过翻译相关 25 项测试。

## 2. 验证与同步

- [x] 2.1 同步行为规格，通过完整后端测试、Rust 格式、OpenSpec 严格验证及 ADR 验证，记录证据。

## Verification

- Before fixes: `cargo test --lib --features test-helpers --manifest-path src-tauri/Cargo.toml services::translation::tests`: 13 passed, the four new regression tests failed on the reported production paths.
- After fixes: `cargo test --lib --features test-helpers --manifest-path src-tauri/Cargo.toml translation`: 25 passed.
- `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`: all unit, integration and doc suites passed (303 unit tests passed; two existing performance tests remain ignored by default).
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `openspec validate --all --strict`, `adrkit validate --all`, `git diff --check`: passed.
- Frontend code is unchanged; frontend suite was not rerun. No live provider requests, native-window panic repro, or modifications to user Skill files.
