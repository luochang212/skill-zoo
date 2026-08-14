# SSOT Scan

## Purpose

定义 SSOT 与 agent 目录扫描的技能识别边界：应用自身的临时/备份目录（`.{name}.{install|update|backup}.`）不得被识别为技能，真实技能目录（包括点前缀命名空间）必须照常被发现。

## Requirements

### Requirement: 扫描跳过应用自身的临时/备份目录

扫描技能目录时，系统 MUST 跳过应用自身的临时/备份目录（命名遵循 `.{name}.{install|update|backup}.` 模式，如 `.demo.install.456`、`.demo.backup.123.0`），不得将其识别为技能。其他以 `.` 开头的目录名（如 `.system` 命名空间）是真实技能目录，MUST 照常识别。

#### Scenario: 残留备份目录不被识别为技能
- **WHEN** SSOT 中存在 `.demo.backup.123.0/` 目录且内含 SKILL.md（更新清理失败的残留）
- **THEN** 该目录不被识别为技能，不出现在已安装技能列表中

#### Scenario: 残留安装临时目录不被识别为技能
- **WHEN** SSOT 中存在 `.demo.install.456/` 目录且内含 SKILL.md（崩溃残留）
- **THEN** 该目录不被识别为技能

### Requirement: 真实技能目录不受影响

真实技能目录（包括 `.system` 这类点前缀命名空间）MUST 照常被发现并识别。

#### Scenario: 普通技能目录照常扫描
- **WHEN** SSOT 中存在 `demo/` 目录且内含 SKILL.md
- **THEN** `demo` 被识别为技能，行为与修复前一致

#### Scenario: 点前缀命名空间照常扫描
- **WHEN** SSOT 中存在 `.system/openai-docs/` 目录且内含 SKILL.md
- **THEN** `openai-docs` 被识别为技能（`directory` 为 `.system/openai-docs`）

### Requirement: 外部导入扫描不受影响

经由 agent 目录 symlink 匹配的外部导入 MUST NOT 因隐藏目录过滤而丢失。

#### Scenario: 外部导入照常发现
- **WHEN** agent 目录中的 symlink 指向已注册的外部导入源目录
- **THEN** 该外部导入照常被发现（symlink 分支先于目录名过滤）
