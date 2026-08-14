# Tasks: skip-hidden-dirs-in-ssot-scan

## 1. 实现

- [x] 1.1 `scan_dir_recursive_into`（services/skill.rs）在 SKIP_DIRS 检查处增加 `dir_name.starts_with('.')` 跳过（置于 SKILL.md 识别之前；symlink 分支保持在前不受影响）
- [x] 1.2 确认 `scan_filesystem_into` 的调用链无其他遗漏的识别入口（scan_external_imports_into 走注册表匹配，不遍历隐藏目录，无需改）

## 2. 验证

- [x] 2.1 `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` 全套通过（194 passed / 0 failed；行为级幽灵技能测试受路径硬编码 + `detect_agent_for_path` expect 限制不可构造，见 proposal Impact）
- [x] 2.2 `cargo clippy --features test-helpers --manifest-path src-tauri/Cargo.toml` 干净
- [x] 2.3 `openspec validate skip-hidden-dirs-in-ssot-scan --strict` 通过
