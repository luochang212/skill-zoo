# Proposal: skip-hidden-dirs-in-ssot-scan

## Why

SSOT 扫描（`scan_dir_recursive_into`，src-tauri/src/services/skill.rs:836）对目录只检查 `SKIP_DIRS`（node_modules/.git/dist/build/__pycache__，config.rs:9），**不过滤隐藏目录**。而应用的临时/备份目录全部以 `.` 开头且落在 SSOT 内：

- 更新备份目录 `.name.backup.<pid>.<nanos>.<n>`（`replace_skill_dir_with_rollback`，cli.rs:1007-1013）——`remove_dir_all(&backup)` 的失败被 `let _ =` 吞掉（cli.rs:1012），Windows 上文件被杀软/索引器占用时清理失败很常见；
- 安装临时目录 `.name.install.*`（`create_temp_dir`，cli.rs:118）——崩溃时残留。

这些目录含完整 SKILL.md（备份/临时是技能的完整复制），扫描会把它们识别为技能，出现在 Local 页（名字如 `.demo.backup.123.0`），用户无法理解也无法正常操作（删除可能误删残留）。

已核实：`scan_dir_recursive_into` 的过滤仅 `SKIP_DIRS`；`.backup` 目录是真实目录（非 symlink），不会被 broken-symlink 清理逻辑带走；应用自身的临时目录全部以 `.` 开头（install/update/backup 三种动作的 prefix 均为 `.{name}.{action}.`）。

## What Changes

- `scan_dir_recursive_into` 在 SKIP_DIRS 检查处一并跳过 `.` 开头的目录名（隐藏目录）。
- 外部导入不受影响：external import 经 symlink 分支匹配（先于目录遍历检查），源目录不被遍历。

## Capabilities

### New Capabilities

- `ssot-scan`: SSOT 与 agent 目录的文件系统扫描，必须只把真实的技能目录识别为技能，忽略应用自身的隐藏临时/备份目录。

### Modified Capabilities

（无。）

## Impact

- 代码：`src-tauri/src/services/skill.rs` `scan_dir_recursive_into` 一处过滤。
- 验证约束（如实记录）：`detect_agent_for_path` 对非真实 agent 目录返回 None 且调用处 `.expect()` panic，行为级回归测试（向扫描器注入 tempdir）不可行；验证 = 结构修复 + 全套测试无回归 + 代码审查。
