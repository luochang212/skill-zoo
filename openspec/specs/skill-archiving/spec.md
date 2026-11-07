# Skill Archiving

## Purpose

定义归档与恢复技能的失败回滚契约：任何错误路径（包括缓存/元数据持久化失败）都必须能够完成回滚，且不得阻塞或挂起。

## Requirements

### Requirement: 持久化失败的回滚不得持有状态锁

归档或恢复过程中，当缓存或元数据保存失败并进入回滚时，系统 MUST NOT 在同一线程持有该存储的写锁。回滚重新获取锁必须能够正常完成，不得永久阻塞。

#### Scenario: 归档时缓存保存失败，回滚完成
- **WHEN** 归档技能过程中缓存保存失败，进入回滚
- **THEN** 回滚重新获取缓存与元数据写锁并恢复快照，归档返回失败结果，命令不挂起

#### Scenario: 归档时元数据保存失败，回滚完成
- **WHEN** 归档技能过程中元数据保存失败，进入回滚
- **THEN** 回滚完成且归档返回失败结果，命令不挂起

#### Scenario: 恢复时元数据保存失败，回滚完成
- **WHEN** 恢复归档技能过程中元数据保存失败，进入回滚
- **THEN** 回滚完成且恢复返回失败结果，命令不挂起

### Requirement: 成功归档与恢复的状态一致

归档成功后，技能 MUST 存放于归档位置，不再作为已安装技能出现；归档记录、技能缓存与用户元数据 MUST 与该状态一致。恢复成功后，技能 MUST 回到原位，归档记录、技能缓存与用户元数据 MUST 与恢复后的状态一致。

#### Scenario: 正常归档成功
- **WHEN** 归档过程中所有保存操作成功
- **THEN** 技能位于归档位置，不再出现在已安装列表中，归档记录、缓存与元数据反映归档状态，操作返回成功

#### Scenario: 正常恢复成功
- **WHEN** 恢复过程中所有保存操作成功
- **THEN** 技能回到原位并重新出现在已安装列表中，对应归档记录被移除，缓存与元数据反映恢复状态，操作返回成功

### Requirement: Archive mutations coordinate with other local writers and refreshes

Archive and restore MUST acquire the shared local writer lease and serialize their scan-and-mutation work against cache rebuilds. Waiting or cancelled operations MUST NOT leave a writer lease held. Existing update-exit protection MUST cover the entire operation.

#### Scenario: A cache refresh is active
- **WHEN** an archive or restore begins while a serialized refresh is active
- **THEN** it waits before changing files and stores

#### Scenario: A waiting operation is cancelled
- **WHEN** an operation is cancelled while waiting for refresh coordination
- **THEN** its local writer lease is released without moving files

### Requirement: Restore preserves the selected physical skill identity

Archive and restore MUST operate on the selected skill's recorded physical home and ownership. A same-name skill at another home MUST NOT replace its identity or have its files, metadata or SSOT provenance consumed by that operation. Historical IDs and retained imports MUST remain supported under the local protocol.

#### Scenario: An agent skill has the same directory as an SSOT installation
- **WHEN** that agent skill is archived and restored
- **THEN** it returns to its agent home with its own identity and user flags, and the independent SSOT installation and lock entry remain unchanged

### Requirement: Unsupported historical ownership is rejected without destructive migration

Restore MUST accept only SSOT and agent-owned archive records. External/plugin/unknown historical ownership and agent records without their original home MUST be rejected before moving files, retaining their records and archived/source files for inspection and manual recovery. Historical agent lock snapshots MUST NOT be applied to SSOT. Deterministic canonical-SSOT fallback and existing metadata-ID migration MAY remain supported.

#### Scenario: An old external record contains archived files
- **WHEN** restore receives that record
- **THEN** it reports unsupported ownership and does not delete its archive directory or original source

#### Scenario: An agent record lacks its original home
- **WHEN** restore receives that record
- **THEN** it reports the missing original destination and retains the archive instead of guessing a current agent or SSOT directory

### Requirement: Failed lifecycle operations recover the complete prior store state

Ordinary archive/restore failure MUST attempt recovery of the prior cache, metadata, manifest and installation lock, in addition to the operation's moved files and links. Recovery MUST release individual state locks before reacquiring them. If recovery is incomplete, the failure MUST disclose that condition. This requirement does not establish process-crash or power-loss atomicity.

#### Scenario: Restore fails after temporarily replacing a lock record
- **WHEN** restore writes a lock record and a later step fails
- **THEN** recovery reinstates the prior lock record rather than deleting it by key

#### Scenario: Recovery cannot persist a store
- **WHEN** an operation fails and a recovery save also fails
- **THEN** the operation reports both the original failure and the incomplete recovery
