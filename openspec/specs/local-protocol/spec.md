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


### Requirement: Stable user metadata identity

Desktop and CLI MUST address SSOT user flags by installation-relative directory according to docs/local-protocol.md, independently of provenance and cache IDs. Other origins MUST retain their existing IDs. All metadata lifecycle operations MUST use the same rule.

#### Scenario: Provenance changes without moving the slot
- **WHEN** a marked SSOT skill changes to another valid source, a malformed source, or has its lock removed and cache rebuilt
- **THEN** starred and isMine remain associated with the same installation directory on both surfaces

#### Scenario: Historical archive restored
- **WHEN** an archive with a historical repo originalSkillId is restored
- **THEN** its flag snapshot is written using the restored origin and directory, without changing the historical archive format

### Requirement: Conservative versioned metadata migration

Desktop and CLI MUST migrate legacy metadata once under the shared mutation lease using filesystem directory evidence, preserve ambiguous or unparseable records, and refuse future-version writes. Migration MUST NOT OR flags, overwrite conflicting values, consume imports' identities, or depend on cache data. Shared metadata fixtures MUST verify these semantics.

#### Scenario: Unambiguous legacy records
- **WHEN** a legacy candidate or equal candidates identify an existing SSOT slot without conflicting target flags
- **THEN** one atomic v1 save moves the records to its stable key and repeated reads do not migrate again

#### Scenario: Conflicting or unbound metadata
- **WHEN** candidates disagree, the target disagrees, a retained import owns the ID, or attribution lacks safe directory evidence
- **THEN** original entries remain intact and unbound candidates are reported for explicit manual assignment or discard

#### Scenario: Future metadata version
- **WHEN** a metadata mutation encounters a version above v1
- **THEN** the operation fails with an upgrade message and preserves the original bytes

### Requirement: Conservative provenance update authorization

Desktop remote updates MUST inspect the physical target using the provenance contract in docs/local-protocol.md and fixtures/local-protocol/. Tracking or unreadable targets MUST be refused before remote work. Local issues MUST precede pin, baseline and source issues. Normal files without reserved metadata MUST remain updatable.

#### Scenario: Reserved tracking or unsafe YAML
- **WHEN** any reserved metadata key exists, or frontmatter cannot be safely read and interpreted
- **THEN** updates and Check report ghProvenanceProtected or skillProvenanceUnreadable respectively, with no remote work for that item and no selectable candidate

#### Scenario: Ordinary Skill Zoo installation
- **WHEN** a valid target has ordinary metadata or only body/root-level github examples
- **THEN** a confirmed remote update replaces the target and writes its normal dual baseline

### Requirement: Refused update preservation

Refused updates MUST preserve target directory bytes and symlink destinations. Single-item and wholly refused batches MUST preserve lock bytes; mixed batches MUST preserve refused entries semantically, including unknown fields. Observed target identity or SKILL.md byte changes during checking/download MUST report updateStateChanged before replacement and preserve the external state.

#### Scenario: Mixed batch
- **WHEN** a batch contains a protected item and an ordinary updatable item
- **THEN** the ordinary item updates, the protected item and its original lock entry remain unchanged, and counts/history report the per-item outcomes

#### Scenario: External edit while downloading
- **WHEN** SKILL.md or target identity changes after authorization and before final replacement
- **THEN** the update is refused with updateStateChanged, and the observed external files and lock remain untouched

### Requirement: CLI preserves provenance within its lifecycle boundary

CLI scan, archive and restore MUST preserve original SKILL.md bytes, including reserved metadata. Shared desktop fixtures MUST exercise real filesystem operations. The CLI MUST NOT claim a remote update implementation or create a separate provenance schema.

#### Scenario: Tracking installation archived and restored
- **WHEN** the CLI scans, archives and restores the shared gh-injected fixture
- **THEN** SKILL.md retains its original bytes and lock entry fields are preserved

### Requirement: Physical installation and original lock key association

Desktop and CLI MUST resolve complete real installation inventory before selecting a shared lock entry, following docs/local-protocol.md and shared fixtures. All candidates and reverse ownership MUST be checked before deciding Resolved, Missing or Ambiguous. External imports MUST NOT own entries, uncorroborated agents MUST NOT inherit SSOT entries, and visibility MUST NOT change ownership.

#### Scenario: Flat installation with namespace lock key
- **WHEN** a flat demo has matching GitHub repo and source directory evidence for author/demo
- **THEN** scans associate its original entry while keeping demo as its physical installation directory and preserving lock bytes

#### Scenario: Competing associations
- **WHEN** multiple keys match, a shared entry matches independent real directories, or valid evidence contradicts a traditional key
- **THEN** scanning preserves the file object without invented provenance and mutations reject ambiguity before changing files or stores

### Requirement: Exact-key lifecycle and physical update targets

All consumers MUST use installation directory for file replacement, refresh and Check/checked identity, and original lock key for baseline writes and lock removal. Updates MUST re-resolve current inventory and compare the original complete entry snapshot before replacement and baseline commit. Missing associations MUST refuse remote update and MUST NOT guess a key during local deletion/archive/editing. C2 tracking protection MUST remain enforced.

#### Scenario: Historical leaf update
- **WHEN** .system/demo resolves to the unique historical demo key and a remote update succeeds
- **THEN** only .system/demo is replaced and only demo receives the dual baseline, with no new directory or key

#### Scenario: Association changes during download
- **WHEN** a lock key, entry, competing candidate, physical identity or SKILL.md changes after preparation
- **THEN** replacement is refused with updateStateChanged and the external state is preserved

#### Scenario: Check physical identity
- **WHEN** a physical installation resolves to a differently named lock key or has no unique association
- **THEN** Check reports the physical directory, uses lockMissing/lockAmbiguous issues when applicable, excludes dangling lock entries, and never writes the lock

### Requirement: Snapshot restore preserves exact original keys

Archive MUST save the resolved original lockKey and complete lockEntry. Restore MUST check original key conflicts and other candidate ownership before moving files, MUST NOT normalize or rekey original lockKey, and MUST allow an already equal entry without rewriting it. Failure rollback MUST restore only the keys actually changed by the operation to their before values.

#### Scenario: Conflicting restore key
- **WHEN** the archived original key has a different current entry
- **THEN** restore fails before moving the archived directory or changing stores

#### Scenario: Equal entry and later failure
- **WHEN** the original key already contains an equal entry and restore later fails
- **THEN** rollback preserves that existing entry and returns files to the archive
