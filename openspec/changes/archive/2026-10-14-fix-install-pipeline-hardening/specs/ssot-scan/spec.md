# SSOT Scan Delta

## ADDED Requirements

### Requirement: BOM 前缀的 SKILL.md 照常解析元数据

SKILL.md 内容以 UTF-8 BOM（U+FEFF）开头时，系统 MUST 在识别 frontmatter 前剥离 BOM，使 yaml name 与 description 照常解析；不得因 BOM 将元数据静默回退为目录名或空。

#### Scenario: BOM 前缀的 frontmatter 被识别

- **WHEN** SKILL.md 内容以 BOM 开头且含合法 frontmatter（`name`、`description`）
- **THEN** 解析结果包含该 yaml name 与 description，与无 BOM 的同一内容解析结果一致

#### Scenario: 无 BOM 的行为不变

- **WHEN** SKILL.md 内容不含 BOM
- **THEN** frontmatter 解析行为与修复前完全一致
