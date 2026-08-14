# Tasks: fix-archive-rollback-lock-deadlock

## 1. 重构三处锁作用域

- [x] 1.1 归档 cache 分支（commands/skill.rs 约 1681-1690）：`save()` 失败时显式 `drop(cache)` 释放写锁后再调用 rollback
- [x] 1.2 归档 metadata 分支（约 1692-1701）：同上（`drop(metadata)`）
- [x] 1.3 恢复 metadata 分支（约 1900-1918）：同上（`drop(metadata)`）
- [x] 1.4 复查所有 `return Err(rollback` 调用点：1664/1674（锁前）、1685/1699/1910（锁获取失败未持锁）、1715/1901/1952/1968/2005/2009/2015（锁后）均无持锁调用 rollback；三处 save 失败路径已修复

## 2. 验证

- [x] 2.1 `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` 全套通过（193 passed / 0 failed；行为级死锁测试受路径硬编码限制不可构造，见 proposal Impact）
- [x] 2.2 `cargo clippy --features test-helpers --manifest-path src-tauri/Cargo.toml` 干净
- [x] 2.3 `openspec validate fix-archive-rollback-lock-deadlock --strict` 通过
