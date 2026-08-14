# Design: skip-hidden-dirs-in-ssot-scan

## Context

`scan_dir_recursive_into`（services/skill.rs:836）遍历 SSOT 与 agent 目录，对每个目录：symlink 分支（外部导入匹配）→ 非目录跳过 → SKIP_DIRS 检查 → SKILL.md 存在即识别。应用自身的临时目录（`.name.install.*`、`.name.backup.*`、`.name.update.*`）全部以 `.` 开头且含完整技能内容，清理失败/崩溃残留后会被识别为幽灵技能。

## Goals / Non-Goals

**Goals:**
- 扫描跳过 `.` 开头目录名，识别边界与"应用自己的临时目录命名约定"对齐。

**Non-Goals:**
- 不主动清理残留目录（删除属于运维/启动清理职责，超出本 change；且"应用不删用户目录里它认不得的东西"更安全）。
- 不改 `create_temp_dir`/`unique_backup_path` 的命名（命名约定已是 `.` 前缀，本次修复消费这个约定）。

## Decisions

1. **在 SKIP_DIRS 检查处一并跳过 `starts_with('.')` 的目录名**（一行条件，与 `crate::config::SKIP_DIRS.contains(&dir_name)` 并列）。位置：在 `SKILL.md` 识别之前——隐藏目录即使含 SKILL.md 也不识别。
2. **不动 symlink 分支**：`is_symlink_or_junction` 检查在目录名过滤之前，外部导入的 symlink 匹配不受影响（spec 的第三条需求）。SSOT 内的 symlink 若 target 是外部导入源，仍照常匹配。
3. **不动 `scan_dir`（cli.rs 的发现阶段）**：它已跳过 symlink 目录；隐藏目录若含 SKILL.md 会作为技能被"发现"——但发现的是**源仓库**内容（解压树），仓库内 `.foo/` 是否算技能由安装选择层决定，与 SSOT 扫描的语义不同，不在本 change。

## Risks / Trade-offs

- [用户自定义的隐藏技能目录（如 `.hidden-skill/`）不再被识别] → 技能目录以 `.` 开头本就不是约定用法（agent 链接名、SSOT 均无此先例）；应用自身临时目录的 `.` 前缀约定是既有事实，二者冲突时以应用内部一致优先。
- [行为级测试不可行] → `detect_agent_for_path` 对非真实路径 `expect` panic，无法向扫描器注入 tempdir；验证 = 结构审查 + 全套测试（此约束已记录于 proposal Impact）。

## Migration Plan

无数据迁移。已存在的幽灵技能缓存条目在下次 rebuild（watcher/启动）时自然消失——`replace_all` 以扫描结果为真相重建缓存。
