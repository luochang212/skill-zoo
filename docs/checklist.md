# Windows 验证清单

## 1. symlink_target_matches 的 junction fallback 路径

**代码位置：** `src-tauri/src/services/skill.rs:130-143`

**要验证的行为：**

1. Windows junction 上 `std::fs::read_link` 的实际返回值是什么？（成功/失败，失败时什么错误类型）
2. 如果 `read_link` 成功但返回的是 NT 设备路径或 GUID 路径，后续的 `target.is_relative()` 判断和 `join`/`canonicalize` 是否仍正确？
3. junction fallback（`canonicalize` 两边）在损坏的 junction 上是否产生 `None == None → true` 的误报？
4. 正常 junction 指向 SSOT 路径时，fallback 路径是否正确报告匹配？

**当前状态：** 逻辑未在 Windows 上验证，存在已知的 `None == None → true` 问题会连带影响 fallback 路径的错误行为。

**验证方法：** 在 Windows 上创建 junction → 用此应用安装一个 skill → 检查 `detect_agents` 和 `get_symlink_status` 的返回值是否符合预期。同时构造一个损坏的 junction 验证错误行为。

## 2. Ok 分支和 Err fallback 的解析策略等价性

**代码位置：** `src-tauri/src/services/skill.rs:131-143`

**问题：** 对于同一个 junction，`canonicalize(link_path)` 是否保证等价于 `canonicalize(resolve(read_link(link_path)))`？

- Ok 分支：`read_link` 拿到 target 文本 → 如果是相对路径 join parent → canonicalize target
- Err fallback：`read_link` 失败 → 跳过 target 文本，直接 canonicalize symlink 本身

**要验证的行为：**

1. Windows 上 `GetFinalPathNameByHandle`（Rust `canonicalize` 的底层实现）对 `IO_REPARSE_TAG_MOUNT_POINT`（junction）是否总是完全解析？
2. 网络路径上的 junction 是否存在不被完全解析的例外？
3. 如果 junction 目标本身就是一个相对路径，`canonicalize(link_path)` 是否像 Ok 分支的 join+canonicalize 一样正确解析？

**当前状态：** macOS 上普通 symlink 两者等价已验证。Windows junction 的等价性是理论推断（文档表明 `GetFinalPathNameByHandle` 递归解析所有 reparse point），未用实际 Windows 环境验证。

**验证方法：** 在 Windows 上创建目标为相对路径的 junction，分别用 Rust 代码测试两种解析方式的结果是否一致。
