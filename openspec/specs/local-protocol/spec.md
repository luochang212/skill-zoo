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
