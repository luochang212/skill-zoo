# Local Protocol

## Purpose

定义桌面应用与配套 CLI 共享本地状态时的兼容性契约。文件路径、字段、版本及写入语义以 docs/local-protocol.md 为详细定义，以 fixtures/local-protocol/ 为共同验证样例，本规范不另建一套字段 schema。

## Requirements

### Requirement: CLI 遵循桌面拥有的本地协议

桌面与 CLI 对共享状态的读写 MUST 遵循 [本地协议文档](../../../docs/local-protocol.md) 的文件、版本与语义定义。CLI MUST NOT 为适配自身实现而独立改变共享状态格式或桌面协议 fixtures。

#### Scenario: 两端读取共同 fixtures
- **WHEN** 桌面和 CLI 读取 fixtures/local-protocol/ 中的当前版本完整与最小样例
- **THEN** 两端均按协议解释字段并为缺失的可选字段使用兼容默认值

### Requirement: 不覆盖不支持的新版本状态

桌面与 CLI 写入版本化的 lock、archive manifest 或 external imports 文件前 MUST 拒绝不支持的更高版本，并提示升级。被拒绝的写入 MUST NOT 覆盖原文件。

#### Scenario: 共享状态版本高于支持上限
- **WHEN** 工具尝试写入 schema 版本高于自身支持上限的版本化文件
- **THEN** 操作失败并提示升级，原文件保持不变

### Requirement: 外部导入的源文件保持用户所有权

外部导入 MUST 以注册引用和 agent 链接接入。应用与 CLI MUST NOT 复制、移动、删除或归档导入源文件；移除导入 MUST 仅移除登记与指向该源的应用管理链接。

#### Scenario: 移除外部导入
- **WHEN** 用户移除一条外部导入
- **THEN** 登记及该导入的应用管理链接被移除，源目录及其文件保持不变

### Requirement: Desktop-owned custom agent registry

Desktop and CLI MUST interpret custom-agent registrations using docs/local-protocol.md and shared fixtures/local-protocol/ samples. Missing registry data MUST preserve built-in-only behavior. Malformed or unsupported registry versions MUST be reported rather than silently treated as an empty registry or overwritten: desktop startup degrades to built-in agents while logging the parse failure, subsequent registry mutations surface the parse error, and writers preserve the original bytes.

#### Scenario: Same registration on both surfaces
- **WHEN** desktop and CLI read the complete custom-agent fixture
- **THEN** they resolve identical stable IDs, names and absolute Skills directories

#### Scenario: Shipped support follows custom registration
- **WHEN** desktop and CLI read the shared built-in-collision fixture with its paths mapped to the same temporary home
- **THEN** both preserve custom IDs and bytes, allow disjoint same-name entries, suppress overlapping built-in targets and report the same conflicting custom ID

#### Scenario: Registry absent
- **WHEN** no custom-agent registry exists
- **THEN** built-in agent resolution and existing local-state compatibility remain unchanged

#### Scenario: Unsupported or malformed registry
- **WHEN** a registry has an unsupported schema version or invalid content
- **THEN** readers report the problem, writers preserve its bytes and operations requiring complete agent enumeration do not silently skip its agents

### Requirement: Recoverable lifecycle persistence

Lifecycle writes spanning registrations and retained external references MUST be recoverable as one logical change. Readers MUST NOT observe a committed removal without its required retained-source references. Failed persistence MUST preserve the prior committed state; registry and ownership metadata MUST NOT be reconstructed from the derived skill cache alone.

#### Scenario: Removal persistence interruption
- **WHEN** unregistering is interrupted between recording retained real skills and updating registrations
- **THEN** recovery restores or completes a coherent committed state before subsequent desktop or CLI mutations

#### Scenario: External preservation survives cache rebuild
- **WHEN** the derived skill cache is deleted after unregistering an agent
- **THEN** its retained real skills remain discoverable as external imports with their ownership protection

### Requirement: Removed agent references remain safe

Archived records and other persisted references to absent custom agents MUST remain readable. Restore MUST preserve the recorded entity destination, skip missing agent link targets with a clear status, and MUST NOT reuse a removed registration's identity or silently target its replacement directory.

#### Scenario: Restore after unregistering
- **WHEN** an archive mentions an unregistered custom agent
- **THEN** restore preserves its original destination and reports skipped links without losing the archive or writing to an unrelated agent
