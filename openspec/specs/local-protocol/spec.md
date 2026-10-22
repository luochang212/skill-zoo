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

创建 agent 管理链接时，写入方 MUST NOT 覆盖已存在的路径：目标为实体目录或指向不同目标的既有链接 MUST 拒绝并报错；指向同一目标的既有链接视为幂等成功。允许替换既有链接的仅限显式修复路径，且 MUST 先验证目标路径确为链接（而非实体目录）后才可替换。

#### Scenario: 移除外部导入
- **WHEN** 用户移除一条外部导入
- **THEN** 登记及该导入的应用管理链接被移除，源目录及其文件保持不变

#### Scenario: 导入遇到同名实体目录
- **WHEN** 某个 agent 目录下已存在与导入源同名的实体技能目录（含 SKILL.md）
- **THEN** 该导入被拒绝并在结果中报告失败，实体目录内容保持原样，不创建任何链接，导入登记不新增

#### Scenario: 导入遇到指向别处的既有链接
- **WHEN** 某个 agent 目录下的同名路径是指向另一目标的链接
- **THEN** 该导入被拒绝并报告失败，既有链接保持不变

#### Scenario: 同目标链接重复导入幂等
- **WHEN** agent 目录下已存在指向同一导入源的链接
- **THEN** 不重复创建、不删除重建，结果按成功处理

#### Scenario: 修复路径替换无效链接
- **WHEN** 修复命令验证某 agent 路径确为链接且指向无效目标，将其替换为期望目标
- **THEN** 仅该链接被替换；若路径为实体目录，修复 MUST 跳过而不是删除

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

### Requirement: 用户元数据身份锚定安装目录

用户元数据（stars、isMine）的键 MUST 由技能的安装位置派生，而不得把安装来源（provenance）编入键。SSOT 技能的身份键 MUST 恒为 `ssot:{relative_dir}`，其中 `relative_dir` 是相对 SSOT 根（`~/.agents/skills/`）的规范化目录；同一安装目录在来源漂移（lock 丢失、损坏、来源字段变更）前后 MUST 解析为同一身份键。agent 来源技能的身份键保持 `agent:{agent_id}:{dir}`，外部导入保持其注册表 ID。

#### Scenario: lock 丢失后星标存活

- **WHEN** 一个 `repo:{owner}/{repo}:{dir}` 键下存有星标的 metadata.json，对应的 SSOT 技能目录仍在，而 lock 文件不存在或不含该条目
- **THEN** 重新扫描后该技能的 ID 为 `ssot:{dir}`，且读取到 `starred == true`

#### Scenario: 旧键读取时确定性重键

- **WHEN** metadata.json 中存在 `repo:{owner}/{repo}:{dir}` 形式的键
- **THEN** 读取端（桌面与 CLI）将其重键为 `ssot:{dir}`；若已存在同目录的 `ssot:{dir}` 条目，两个条目的 starred 与 isMine 分别按 OR 合并，且合并后持久化，旧键不再残留

#### Scenario: 安装目录含冒号

- **WHEN** 遗留元数据键为 `repo:owner/repo:foo:bar`，安装目录为 `foo:bar`
- **THEN** 两端迁移后的键为 `ssot:foo:bar`，重新扫描仍读取到原有用户标记

#### Scenario: 迁移写回失败

- **WHEN** 遗留元数据可读取，但迁移结果无法持久化
- **THEN** 两端 MUST 告警并使用已迁移的内存状态继续读取技能及其用户标记，磁盘旧内容保留供后续读取重试

#### Scenario: 非遗留键不受迁移影响

- **WHEN** metadata.json 中仅含 `ssot:`、`agent:`、`external:` 前缀的键
- **THEN** 读取与保存不改变任何键，迁移不产生写入

### Requirement: 归档恢复经身份映射写回元数据

归档恢复在把 manifest 快照的用户标记写回 metadata 时，MUST 将 manifest 中的历史 `original_skill_id` 映射为当前身份规则下的规范键后再写入，使恢复后同会话内扫描即可关联到这些标记。归档 manifest 中的历史 ID 本身 MUST 保持原样，不做改写。

#### Scenario: 遗留 ID 的恢复写回规范键

- **WHEN** manifest 的 `original_skill_id` 为 `repo:{owner}/{repo}:{dir}` 且快照了 `starred == true`，恢复到 SSOT 目录 `{dir}`
- **THEN** metadata 中新增/合并的键为 `ssot:{dir}`，恢复后无需重启即可读到星标；manifest 中记录的历史 ID 不被改写（条目本身按既有行为随恢复移除）

### Requirement: 双端身份规则一致

桌面与 CLI MUST 使用相同的身份键规则与迁移规则：两端对同一文件系统状态构造的身份键一致，对同一份 metadata.json 的重键结果一致。协议 fixtures MUST 覆盖含遗留 `repo:` 键的 metadata 样本及合并结果。

#### Scenario: 两端读取同一份遗留 metadata

- **WHEN** 桌面与 CLI 分别读取同一个含 `repo:{owner}/{repo}:{dir}` 键的 metadata.json
- **THEN** 两端为位于 SSOT `{dir}` 的同一技能报告相同的星标与 isMine 状态，且键收敛为 `ssot:{dir}`

### Requirement: 用户元数据写入遵循磁盘权威与共享租约

桌面与 CLI 通过共享租约互斥写操作。桌面侧任何整表保存用户元数据的写路径 MUST 在持租约后、变更前从磁盘重载元数据，使 CLI 在会话期间提交的标记不被内存旧快照覆盖；缓存刷新路径 MUST 从磁盘重载元数据后再渲染用户标记。

#### Scenario: CLI 提交的标记在桌面写入后存活
- **WHEN** 桌面会话启动后 CLI 在磁盘 metadata.json 中写入某技能的星标，随后桌面在共享租约内为另一技能加星并保存
- **THEN** 磁盘上两个技能的星标均存在

#### Scenario: 刷新观察 CLI 结果
- **WHEN** CLI 更新磁盘元数据后桌面触发缓存刷新
- **THEN** 刷新从磁盘重载元数据，界面呈现 CLI 提交的用户标记

#### Scenario: 刷新与写入交错
- **WHEN** 元数据写者在锁内修改并保存，刷新同时等待该锁
- **THEN** 刷新读取锁内写入完成后的磁盘状态，不把旧快照替换回内存；批量元数据变更与持久化期间不被刷新插入

### Requirement: 重复合并不丢失用户标记与原件

重复合并到 SSOT 时，写入方 MUST 先验证合并目标可用（目标为可验证的同一内容技能或不存在），并验证各源内容后才能删除原件；目标不可用时 MUST 拒绝合并且不删除任何原件。写入方自己创建的合并目标在校验失败时 MUST 清理，不得留下占用同名路径的半成品，使后续合并仍可重试。合并写入用户元数据时 MUST 先移除旧身份键再写入合并后键，使键重合时标记不丢失。

#### Scenario: 已有 SSOT 的合并保留星标
- **WHEN** agent 目录技能与已有 SSOT 技能内容一致并合并，且 SSOT 键已有星标
- **THEN** 合并成功后该 SSOT 键的星标与 isMine 保持

#### Scenario: 无效目标拒绝合并且原件保留
- **WHEN** SSOT 同名目录存在但不含 SKILL.md（不可作为合并目标）
- **THEN** 合并失败报错，各 agent 目录下的原技能文件保持原样

#### Scenario: 目标校验失败不留半成品
- **WHEN** 源目录含符号链接文件，无法无损合并
- **THEN** 合并返回可读错误，本次创建的 SSOT 目录被清理，原技能文件保持原样，下一次合并不会因「目标已占用」而无法重试

#### Scenario: 目录符号链接不被静默丢弃
- **WHEN** 合并源包含目录符号链接或平台等价链接
- **THEN** 合并被拒绝，原技能及链接目标保持不变，本次创建的合并目标被清理

### Requirement: 读写保留未知可选字段

对 lock 等版本化共享状态执行读-改-写的工具 MUST 保留其未识别的可选字段（根级与条目级），使更新生产者写入的数据不被旧写入者丢弃。共同 fixtures MUST 含未知可选字段样本，双端 MUST 验证保留。

#### Scenario: 未知字段经往返保留
- **WHEN** 读取含根级与条目级未知字段的 lock 文件并执行一次写回
- **THEN** 重新读取后这些未知字段仍存在且值不变

#### Scenario: 重装保留同身份条目的附加字段
- **WHEN** 安装更新已有同身份 lock 条目的已知来源与路径字段
- **THEN** 根级和该条目未识别的可选字段仍保留，其他技能条目不受影响

### Requirement: skillFolderHash records the installed content baseline

The `skillFolderHash` field of a lock entry SHALL hold the desktop's content baseline for an installed skill folder, with the canonical definition, write points and unknown-baseline rule documented in `docs/local-protocol.md` and exercised by `fixtures/local-protocol/`. The desktop SHALL write the field when it installs or updates a repo-backed skill.

#### Scenario: Fixture parity

- **WHEN** the desktop parses the shared lock fixtures containing a populated `skillFolderHash`
- **THEN** it treats the value as a usable baseline for drift comparison

#### Scenario: Same content, same baseline

- **WHEN** the same skill folder content is hashed twice
- **THEN** the recorded baseline value is identical, and renaming or editing any regular file changes it

#### Scenario: Baseline is written on content writes

- **WHEN** the desktop installs or updates a repo-backed skill
- **THEN** the entry's stored value describes the newly written folder content

### Requirement: Unknown baselines are tolerated by both surfaces

A lock entry with no `skillFolderHash` or an empty string SHALL be read as an unknown baseline, not a mismatch. The desktop SHALL NOT report drift for such entries and SHALL populate the field on the next install or update write. The CLI SHALL read and preserve the value without interpreting it, and neither surface SHALL fail to read the lock.

#### Scenario: Legacy values are unknown baselines

- **WHEN** a lock entry carries no `skillFolderHash`, an empty string, or a legacy value this app's algorithm could not have produced (for example the 40-character git commit SHA written by older writers)
- **THEN** both surfaces accept the entry and the desktop does not claim the skill is locally modified

#### Scenario: CLI preserves without interpreting

- **WHEN** the CLI reads and rewrites lock state containing a populated `skillFolderHash`
- **THEN** the value passes through unchanged
