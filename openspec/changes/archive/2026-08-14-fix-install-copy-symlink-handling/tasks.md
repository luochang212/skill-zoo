# Tasks: fix-install-copy-symlink-handling

## 1. 回归测试先行（红）

- [x] 1.1 在 `src-tauri/src/services/cli.rs` 的 `mod tests` 中补回归测试（`#[cfg(unix)]`）：技能目录含指向外部目录的软链时，复制结果不含外部内容
- [x] 1.2 补测试：含 `loop -> .` 循环目录软链时，普通文件照常复制、循环条目被跳过、不产生误导性错误
- [x] 1.3 补测试：有效相对文件软链（目标从链接所在目录可解析）被以链接名复制且内容正确
- [x] 1.4 补测试：悬空软链目标恰好命中进程 CWD 下同名文件时，不复制任何 CWD 内容
- [x] 1.5 补测试：目录嵌套超过深度上限时报明确错误
- [x] 1.6 运行 `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`，确认新旧用例中 1.1–1.4 按当前代码为红（1.5 视上限实现前行为记录）

## 2. 实现（绿）

- [x] 2.1 重排 `copy_dir_contents` 分支：软链检查（`is_symlink_or_junction`）先于 `is_dir()`；解析为目录的软链（含 junction）直接跳过
- [x] 2.2 文件软链改为以 `link.parent().join(read_link(target))` 解析，目标为普通文件则复制内容，否则跳过；移除对裸 target 的 `exists()`/`copy`
- [x] 2.3 为 `copy_dir_contents` 增加深度参数，超过 20 层返回 `AppError::Cli` 明确错误（数值与 `scan_dir` 对齐）
- [x] 2.4 重跑后端测试，全部转绿（全套 193 passed / 0 failed）

## 3. 验证与收尾

- [x] 3.1 `cargo clippy --features test-helpers --manifest-path src-tauri/Cargo.toml` 干净
- [x] 3.2 `openspec validate --change fix-install-copy-symlink-handling --strict` 通过
