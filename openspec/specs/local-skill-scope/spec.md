# Local Skill Scope

## Purpose

定义桌面应用本地技能视图与冲突检查的范围：扫描保留文件系统事实，本地视图按主目录所属 agent 的可见性筛选，外部导入作为管理对象保留，同名冲突不得由不可见对象制造。

## Requirements

### Requirement: 本地视图按技能来源与主目录筛选

本地视图 MUST 包含 SSOT 技能；来自 agent 实体目录的技能 MUST 仅在其 `homeAgent` 可见时出现。有效的外部导入 MUST 作为管理对象保留，即使未链接任何 agent。agent 可见性 MUST NOT 使应用停止发现其实体技能目录。

#### Scenario: 隐藏实体目录所属 agent
- **WHEN** 技能主目录位于已隐藏的 agent 中
- **THEN** 技能不进入本地可见范围，其文件仍被扫描保留，重新显示该 agent 后可进入本地视图

#### Scenario: SSOT 技能没有 agent 链接
- **WHEN** SSOT 中的技能未链接到任何可见 agent
- **THEN** 技能仍属于本地可见范围

#### Scenario: 外部导入没有 agent 链接
- **WHEN** 有效外部导入未链接任何 agent
- **THEN** 该导入仍作为本地管理对象可见

### Requirement: 一致性与发现冲突使用同一可见范围

同名重复与冲突检查、Discover 和仓库安装候选的冲突检查 MUST 使用 SSOT 加可见 agent 实体技能的范围。隐藏 agent 的实体技能和外部导入 MUST NOT 参与这些同名检查。实际安装的目标预检 MUST 遵循 skill-installation 规范中的本次所选 agent 范围。

#### Scenario: 隐藏 agent 存在同名技能
- **WHEN** 隐藏 agent 的实体技能与可见技能或远程安装候选同名
- **THEN** 隐藏技能不产生本地重复提示，也不使安装候选被标记为冲突

#### Scenario: 外部导入与安装候选同名
- **WHEN** 外部导入与可见技能或远程安装候选同名
- **THEN** 导入仍可管理，但不参与同名重复与安装候选冲突判定

#### Scenario: 可见 agent 的实体技能与安装候选同名
- **WHEN** 可见 agent 中已有实体技能与远程安装候选同名
- **THEN** 该实体技能参与安装候选的冲突判定
