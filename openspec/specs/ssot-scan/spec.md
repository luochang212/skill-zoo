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

### Requirement: BOM 前缀的 SKILL.md 照常解析元数据

SKILL.md 内容以 UTF-8 BOM（U+FEFF）开头时，系统 MUST 在识别 frontmatter 前剥离 BOM，使 yaml name 与 description 照常解析；不得因 BOM 将元数据静默回退为目录名或空。

#### Scenario: BOM 前缀的 frontmatter 被识别
- **WHEN** SKILL.md 内容以 BOM 开头且含合法 frontmatter（`name`、`description`）
- **THEN** 解析结果包含该 yaml name 与 description，与无 BOM 的同一内容解析结果一致

#### Scenario: 无 BOM 的行为不变
- **WHEN** SKILL.md 内容不含 BOM
- **THEN** frontmatter 解析行为与既有行为完全一致

### Requirement: Scan paths agree on skill identity and metadata

Full and incremental scans of the same physical skill MUST agree on its identity, origin, directory, source metadata and frontmatter fallback. Existing legacy leaf-name lock lookup MUST behave consistently across those scans.

#### Scenario: Nested skill has a legacy lock entry
- **WHEN** a nested skill has a lock entry keyed by its leaf directory name
- **THEN** full and single-skill scans retain the same repository information

#### Scenario: Nested skill text cannot be decoded
- **WHEN** a nested skill's SKILL.md cannot be decoded as UTF-8
- **THEN** both scan paths use its leaf directory name without inventing a frontmatter mismatch

### Requirement: Refreshes preserve coherent derived state

Watcher incremental refresh and install/update refresh MUST serialize their scan-and-commit work with full rebuilds. An incremental batch MUST persist once, and persistence failure MUST leave its prior in-memory cache intact. Update commands MUST report refresh failure rather than silently returning an unqualified success; already updated skill files MUST remain intact.

#### Scenario: Refresh is already running
- **WHEN** a watcher or install/update refresh starts while another serialized refresh is active
- **THEN** it waits before scanning and committing, so the older refresh cannot overwrite its newer result

#### Scenario: Incremental cache persistence fails
- **WHEN** an incremental batch cannot persist the cache
- **THEN** the previous in-memory cache remains intact and the caller receives an error

#### Scenario: Updated files cannot be refreshed
- **WHEN** skill files update successfully but the subsequent cache refresh fails
- **THEN** the command and update history report the refresh failure without removing the updated source files
