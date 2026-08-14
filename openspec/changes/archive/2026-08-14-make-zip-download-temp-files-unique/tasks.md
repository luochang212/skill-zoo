# Tasks: make-zip-download-temp-files-unique

## 1. 实现（测试先行）

- [x] 1.1 新增测试（红）：`zip_tmp_path` 对同一 owner/repo/branch 的连续调用产生不同路径（修复前函数不存在，编译错误 E0599 即红）
- [x] 1.2 提取 `zip_tmp_path(cache_dir, owner, repo, branch)` 私有函数（唯一名 = 固定前缀 + pid + 纳秒时间戳），`ensure_cached_zip_with_progress` 改用之；测试转绿

## 2. 验证与收尾

- [x] 2.1 `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` 全套通过（194 passed / 0 failed）
- [x] 2.2 `cargo clippy --features test-helpers --manifest-path src-tauri/Cargo.toml` 干净
- [x] 2.3 `openspec validate make-zip-download-temp-files-unique --strict` 通过
