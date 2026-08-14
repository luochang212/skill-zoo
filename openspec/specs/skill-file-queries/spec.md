# Skill File Queries

## Purpose

定义前端技能文件内容查询的缓存契约：查询键必须按技能隔离，失效必须覆盖所有受影响的缓存，且失效清单中不得存在无查询引用的死键。

## Requirements

### Requirement: 文件内容查询按技能隔离

技能文件内容与图片查询的缓存键 MUST 包含技能标识；不同技能的同名文件 MUST NOT 共享缓存条目。

#### Scenario: 两个技能的同名文件独立缓存
- **WHEN** 用户先查看技能 A 的 README.md，再查看技能 B 的 README.md
- **THEN** 两次查询使用不同的缓存键，技能 B 不会先显示技能 A 的内容

#### Scenario: 保存文件内容只失效对应技能
- **WHEN** 用户保存技能 A 的某个文件内容
- **THEN** 仅技能 A 中该路径的文件缓存被失效，技能 B 的同名文件缓存不受影响

### Requirement: 批量更新使内容缓存失效

批量更新技能后，被更新技能的 SKILL.md 内容缓存 MUST 立即失效，用户无需等待文件系统 watcher 或 30 秒 stale 窗口。

#### Scenario: 批量更新后内容即时刷新
- **WHEN** 用户执行"更新全部技能"且其中有技能的 SKILL.md 发生变化
- **THEN** 该技能的内容缓存被失效，重新打开时读取到更新后的内容

### Requirement: 失效清单无死键

失效清单中 MUST NOT 包含任何全项目无查询使用的键前缀。

#### Scenario: 失效清单所有前缀均有查询使用
- **WHEN** 检查失效映射中的每个键前缀
- **THEN** 每个前缀至少被一个 useQuery 查询使用
