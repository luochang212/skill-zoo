# AFunc-OPC/Skiller(★85|Rust + React 18/Tauri 2|2026-08-29 push|MIT)

## 1. 定位与架构(实证)
一句话:DB 优先的技能 CRUD 台账。它用 SQLite 记录磁盘上任意的 file_path,再以复制/软链分发到项目目录或工具预设路径;无中央库、无 SSOT。

- 技术栈:React 18 + Zustand + Vite 5 / Tauri 2 / rusqlite(WAL)(README 技术栈表)。
- SSOT 模型:不存在。`skills` 表以 `file_path TEXT NOT NULL` 指向磁盘任意位置(db/schema.rs:5-15),文件在哪不重要,数据库是台账;SourceMetadata 四型 file/npx/repository/clawhub 仅是来源备注(models/skill.rs:20-29)。分发=复制或软链到 project.skill_path / 工具预设的 global_path(distribution_service.rs:27-58),冲突检查只是目标路径 exists 布尔(models/conflict.rs:9-16),无内容比对、无接管机制。
- 形态:纯桌面 app,无 CLI,无 agent 自管理。
- 技能来源:本地路径、Git 仓库接入(utils/git.rs)、`npx skills` 命令解析导入(models/npx_import.rs:5-44,shell 出 npx 执行再 stage)、ClawHub 在线浏览导入(clawhub_service.rs,1285 行,主要是 API 对接与文件树浏览)。

## 2. 功能清单
- 技能 CRUD/搜索/编辑 [完整] commands/skill.rs + skill_file.rs(2629 行,多为文件读写命令)。
- 标签/标签组(含内置组)多对多 [完整] services/tag_service.rs。
- 项目管理与按项目分发(copy/symlink 二选一) [完整] services/distribution_service.rs。
- 仓库管理(在线 repo 拉取更新) [完整] services/repo_service.rs(949 行)。
- ClawHub 发现/浏览/导入 [完整] services/clawhub_service.rs。
- `npx skills` 命令字符串导入(带 session/进度事件/已存在检测) [半成品]。其本质是 shell 出 `npx skills add` 再把 stage 结果登记进库(skill_service.rs:13-17 校验命令字符串前缀;models/npx_import.rs),重复实现了 skill-zoo 已原生化的通道。
- 多环境配置、代理、i18n、主题 [完整]。

实现质量信号:路径校验硬编码 `C:` `D:` `E:` 盘符判"绝对路径"(skill_service.rs:19-25);DB 11 个 version 的 migrations(db/migrations/)但无从文件系统重建的能力。这是因为文件被用户移动/删除后台账即悬空(symlink_valid 字段只是事后检测)。

## 3. 借鉴候选(90 分门槛)
无。逐项评估结论:标签组(内置组 + 多对多)是普通 CRUD;分发的 copy/symlink 二选一与冲突检查(exists 布尔)均低于 skill-zoo 现有 preflight 水平;ClawHub 对接 skill-zoo 已有同类通道;`npx skills` 导入是 shell-out,方向与 skill-zoo"原生重实现"的决策相反。

## 4. 明确不借鉴(带理由)
- DB 为真相、file_path 指向任意位置:与"文件系统是唯一真相"正面冲突,台账必然漂移。
- `npx skills` shell-out 导入:skill-zoo 已用 CliService 原生重实现,倒退。
- exists 布尔冲突检查与静默分发:低于现有水平,无信息量。
- 内置标签组、多环境配置:无证据支撑的需求面扩张。
- 盘符硬编码路径校验:实现瑕疵,反面教材。

## 5. 借鉴裁定
NOTHING: 架构与 skill-zoo 相反(DB 台账 vs 文件系统真相),功能是常见 CRUD 的平齐实现,唯一有点特色的 `npx skills` 导入恰是 skill-zoo 已抛弃的 shell-out 路线;无可过 90 分门槛的项。
