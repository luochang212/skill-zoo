# Verification

- `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml streaming_description --lib` 在修复前复现：完整 description 预览仍为 Original。
- 修复后翻译相关 27 项测试通过，覆盖服务、生产请求流水线、修复、取消、缓存与源文件保护。
- 新增测试覆盖正文尚未结束、description 分段标记、空值、重复及逆序标记；已有多种 YAML description 写法测试增加 preview 与 restore 一致性检查。
- Rust 格式、OpenSpec strict 和 ADR 格式检查通过，主规格已同步。
- 没有发起真实付费模型请求，没有实测桌面 UI；使用生产 ProtectedMarkdown 与既有 mock 服务端流水线验证。
