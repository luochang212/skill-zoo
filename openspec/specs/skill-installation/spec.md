# Skill Installation

## Purpose

定义技能安装与接入的文件所有权契约：远程技能保存到 SSOT，本地技能保持原位并通过链接共享；安装预检保护目标目录，仓库归档复制遵守软链接与递归深度边界。

## Requirements

### Requirement: 远程安装保存到 SSOT 并以链接接入 agent

远程技能安装 MUST 将仓库归档中的技能文件复制到 `~/.agents/skills/` 下的安装目标，选中的 agent MUST 通过符号链接或平台等价链接引用该目标。应用 MUST NOT 为各 agent 创建独立的技能文件副本。

#### Scenario: 同一远程技能安装到多个 agent
- **WHEN** 用户将一个远程技能安装到两个 agent
- **THEN** SSOT 中存在该技能的实体目录，两个 agent 的技能入口均指向该目录

### Requirement: 本地技能接入保持源目录原位

用户已有的本地技能在接入其它 agent 时 MUST 保留于原始实体目录，应用 MUST NOT 复制或移动源目录。其它 agent 的入口 MUST 直接链接到该技能的实际主目录。

#### Scenario: 接入已有 agent 中的本地技能
- **WHEN** 用户将一个已存在于 agent A 的实体技能目录接入 agent B
- **THEN** agent A 的实体目录保持原位，agent B 的入口指向该目录，SSOT 中不产生副本

### Requirement: 安装预检只检查本次目标范围

安装前系统 MUST 检查 SSOT 和本次安装选中的 agent 目录。任一目标已存在或同一批次包含重复目标时，安装 MUST 在写入技能文件前被拒绝。未选中的 agent 目录 MUST NOT 因同名条目阻断本次安装。

#### Scenario: 所选 agent 存在同名目标
- **WHEN** SSOT 或本次所选 agent 目录存在待安装技能的同名目标
- **THEN** 安装被拒绝，已有目标保持不变

#### Scenario: 未选中的 agent 不制造冲突
- **WHEN** 只有未被本次安装选中的 agent 目录存在同名目标
- **THEN** 该条目不阻断安装

#### Scenario: 批次包含重复安装目标
- **WHEN** 用户选择的多个技能会写入同一个安装目标
- **THEN** 预检拒绝该批次，尚未写入任何技能文件

### Requirement: 复制不得跟随目录软链接

把技能文件从解压后的仓库归档复制进安装目标时，系统 MUST NOT 跟随任何解析为目录的软链接（symlink/junction），无论其目标是仓库内部还是外部路径。

#### Scenario: 指向外部目录的软链接被跳过
- **WHEN** 解压后的技能目录里存在一个软链接，其目标位于该技能目录之外的宿主机路径（绝对路径，或相对路径爬出解压根目录）
- **THEN** 复制结果不包含该软链接，且安装目标中不出现任何来自该外部路径的文件

#### Scenario: 指向祖先目录的循环软链接被跳过
- **WHEN** 技能目录里存在直接或间接解析到自身某个祖先目录的软链接（如 `loop -> .`）
- **THEN** 该条目被跳过，普通文件照常复制，安装不会无限递归，也不产生误报性错误

### Requirement: 文件软链接按链接所在目录解析

复制过程中遇到解析为普通文件的软链接时，系统 MUST 以软链接自身所在目录为基准解析其相对目标；目标解析后必须是指向普通文件的有效路径才复制，否则跳过。系统 MUST NOT 以进程工作目录（CWD）为基准解析软链接目标。

#### Scenario: 有效的相对文件软链接被正确复制
- **WHEN** 技能目录里存在相对软链接（如 `notes.md -> ../../docs/notes.md`），其目标从该软链接所在目录解析后是存在的普通文件
- **THEN** 复制结果包含以该链接名命名的文件，内容为目标文件的内容

#### Scenario: 悬空软链接被跳过且不误拷 CWD 文件
- **WHEN** 软链接目标从链接所在目录解析后不存在，但同名相对路径恰好存在于进程工作目录下
- **THEN** 该条目被跳过，安装目标中不出现来自进程工作目录的任何内容

### Requirement: 复制递归深度有上限

复制过程 MUST 实施最大递归深度；超出上限时以明确错误使该技能的安装失败，而非无界递归。

#### Scenario: 超深目录树报错终止
- **WHEN** 待复制的目录树嵌套深度超过上限（对齐技能发现阶段的深度上限）
- **THEN** 该技能安装失败并返回明确的深度超限错误，进程不挂起、不崩溃

### Requirement: 解压前校验归档规模

解压下载的仓库归档前，系统 MUST 预校验归档的解压总量与条目数：解压总量超过按压缩包大小推导的上限（压缩包大小的倍数，设绝对下限），或条目数超过固定上限时，安装 MUST 以明确错误失败，且不得向磁盘写入任何解压内容。校验阈值 MUST 能容纳合法的大型仓库归档（文本源码压缩比通常不超过数倍）。

#### Scenario: 解压炸弹被拒绝
- **WHEN** 归档声明的解压总量超过按其压缩包大小推导的上限（如高压缩比炸弹）
- **THEN** 返回明确的超限错误，解压目标目录不出现任何文件

#### Scenario: 条目数超限被拒绝
- **WHEN** 归档条目数超过固定上限
- **THEN** 返回明确的超限错误，解压目标目录不出现任何文件

#### Scenario: 正常仓库不受影响
- **WHEN** 合法仓库归档的解压总量与条目数均在上限内
- **THEN** 照常解压并继续安装流程

### Requirement: Update checks detect local modifications

When the update flow inspects a repo-installed skill, the system SHALL compare the installed skill folder's content hash with the `skillFolderHash` baseline stored in the lock entry, and SHALL report the skill as locally modified when they differ. Skills whose lock entry has no usable baseline hash SHALL NOT be reported as modified. The comparison SHALL NOT require any network request.

#### Scenario: Unmodified skill is not reported

- **WHEN** an installed skill folder matches its stored baseline hash
- **THEN** the update check does not report local modifications for that skill

#### Scenario: User edit is detected

- **WHEN** any regular file inside an installed skill folder differs from the content captured by the stored baseline hash
- **THEN** the update check reports that skill as locally modified

#### Scenario: Legacy entry without a baseline

- **WHEN** a lock entry has no `skillFolderHash` value or an empty one
- **THEN** the skill is not reported as locally modified and behaves as before this capability existed

### Requirement: Updates do not silently overwrite drifted skills

The system SHALL NOT apply an update to a skill reported as locally modified without an explicit user decision that local edits are lost. A single update of a drifted skill SHALL require explicit confirmation before overwriting. Batch updates SHALL skip drifted skills, SHALL report them in the completion summary, and SHALL offer an explicit per-skill action to update despite local modifications. Skills without a usable baseline keep the previous behavior and update without a drift prompt.

#### Scenario: Single update cancelled by default

- **WHEN** the user starts a single update for a locally modified skill and does not confirm the overwrite
- **THEN** no file inside the skill folder is changed and the stored baseline is unchanged

#### Scenario: Single update confirmed

- **WHEN** the user confirms overwriting local modifications on a single update
- **THEN** the update applies the repository content and the completion state reflects that local edits were replaced

#### Scenario: Batch update skips drifted skills

- **WHEN** a batch update includes locally modified skills alongside unmodified ones
- **THEN** unmodified skills update normally, drifted skills are skipped and listed in the summary as skipped due to local modifications, and each listed skill can still be updated explicitly afterwards

### Requirement: Successful content writes refresh the baseline

After a remote install completes, or after an update overwrites an installed skill's content, the system SHALL store a fresh content hash for that skill folder in its lock entry. A failed or rolled-back update SHALL NOT change the stored baseline.

#### Scenario: Install writes the baseline

- **WHEN** a remote install finishes writing the skill into the SSOT store
- **THEN** the new lock entry contains the content hash of the installed folder

#### Scenario: Successful update refreshes the baseline

- **WHEN** an update (including an overwrite confirmed by the user) finishes applying new content
- **THEN** the lock entry's stored hash matches the newly installed content

#### Scenario: Failed update keeps the baseline

- **WHEN** an update fails and the previously installed content is restored
- **THEN** the stored hash still describes the restored content and the skill is not reported as modified

### Requirement: Recheck modifications after update preparation

The update flow MUST recheck a usable content baseline after downloading and preparing replacement content, immediately before replacing the installed directory. A newly modified skill MUST remain unchanged unless the user explicitly authorized overwriting that skill. Batch updates MUST report it as skipped; single updates MUST request overwrite confirmation. Existing unknown-baseline behavior MUST remain unchanged.

#### Scenario: Edit while downloading
- **WHEN** a skill matches its baseline at preflight but is edited while update content is prepared
- **THEN** the replacement does not overwrite the edit and its stored baseline remains unchanged

#### Scenario: Explicit overwrite applies to one skill
- **WHEN** the user confirms overwriting a particular skill
- **THEN** its replacement proceeds even if it differs from its baseline, without authorizing overwrites of other skills

### Requirement: Keep unfinished checked updates actionable

After a selected or per-skill update completes, the update manager MUST remove only successfully updated candidates and MUST retain skipped, failed and unselected candidates without another network check. A candidate newly skipped for modifications MUST offer its per-skill overwrite confirmation action.

#### Scenario: Mixed candidate list
- **WHEN** one clean candidate updates successfully while two modified candidates remain
- **THEN** both remaining candidates still offer individual overwrite actions, including after confirming one of them

#### Scenario: Newly modified candidate is skipped
- **WHEN** a selected candidate is skipped because edits occurred after checking for updates
- **THEN** it stays in the list marked as locally modified with an explicit overwrite action
