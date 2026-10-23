# stakpak/paks(★64|Rust|2026-07-04|Apache-2.0)

## 1. 定位与架构(实证)

一句话定位:面向 stakpak 生态的 AgentSkills 标准包管理器。`paks install <name>` 从自家托管 registry 装,git tag 管版本,Web registry 浏览。

技术栈:Rust workspace(apps/cli 约 2.3k 行,packages/core 仅 config/error,packages/api 为 registry 客户端+schemars 类型,apps/web 为 Vite/TS 站点);clap + dialoguer;registry 硬编码 `https://apiv2.stakpak.dev`(apps/cli/src/commands/search.rs:15)。

SSOT/分发模型:**复制到单个 agent 目录,无 SSOT 无链接无锁文件**。`copy_skill_to_target`(apps/cli/src/commands/install.rs:605-714)递归复制;agent 表内置于 `~/.paks/config.toml`(8 个内置 agent,stakpak 优先,apps/cli/src/commands/core/config.rs:225-310),一条命令只装一个 agent,无跨 agent 批量。全库无 update 命令、无 lockfile、无版本追踪,也就是说装完即忘。

形态:brew/二进制 CLI + 托管 registry(publish 需 login,git tag 定版本);技能来源:registry / GitHub URL(浏览器 URL 直接粘贴解析,install.rs:176-211)/ 本地路径。

**与任务简报的偏差必须指出:「CI/自动化向」在代码中无证据**,因为无 `--yes`、无非交互模式、无锁文件、无确定性保证;README 中唯一自动化接口是 `list --format json|yaml`。install 命令本身无提示,但这是简单到没有可提示的东西,不是 CI 设计。

## 2. 功能清单

- [完整] `create`:模板脚手架(basic/devops/coding + 可选 scripts/references/assets)
- [完整] `validate`:按 AgentSkills 规范校验 frontmatter(name 1-64、小写字母数字连字符、禁首尾/连续连字符;description 1-1024;compatibility ≤500,core/skill.rs:115-155)+ 可选目录空目录警告;`--strict` 把警告升级为错误(validate.rs:98-100)
- [完整] `install`:registry(`account/skill[@version]`,install.rs:46-99)/ GitHub tree/blob URL / git URL / 本地路径→复制到单 agent;`--force` 覆盖;装前比对已装版本(:416)
- [完整] `publish`:validate→git tag 语义化版本(`--bump patch/minor/major`)→推送 registry;`--dry-run`;publish.rs:218-277
- [完整] `search`/`login`/`list`/`remove`/`agent`:ROADMAP.md 自认 search/login 曾是 stub,现已实现但 ROADMAP 未更新,是一个文档腐化样本
- [完整] API 客户端分包(packages/api/rust)+ **schemars 从 Rust 类型生成 JSON Schema**(packages/api/schema/src/bin/generate_schema.rs:1-13)
- [半成品] `info`:本地 only,registry 查询缺(ROADMAP 自认)
- [摆设] frontmatter `dependencies` 字段(name+semver range+git+path,SkillDependency,core/skill.rs:89-110):**install 全程不解析**,纯声明摆设
- [摆设] 多 registry 配置(`registries` 表,config.rs:44-46):search/install 客户端硬编码 base_url,配置读了没用

## 3. 借鉴候选(90 分门槛)

无。四个方向逐一核验均不达标,理由见下。

## 4. 明确不借鉴(带理由)

- 「CI 向设计」:简报声称的定位在代码中不存在(无交互跳过、无锁、无可重复安装语义),README 声明未获代码坐实,按纪律不采信。
- AgentSkills 规范的 name/description 校验规则:规范本身要求,非 paks 首创;skill-zoo 安装管线已校验 frontmatter,补齐字符级规则属对照规范表自查,不构成吸收项。
- schemars 类型→JSON Schema 生成:10 行标准 Rust 技巧,非 great;skill-zoo 本地协议以 pinned fixtures 为真相(`fixtures/local-protocol/`),生成式 schema 反而引入第二真相。
- frontmatter 扩展字段(authors/keywords/categories/dependencies):服务其托管 registry 的检索;dependencies 声明即弃(装时不解析)是伪功能;skill-zoo 元数据模型已自足。
- git tag 发布流:绑定其自有 registry 与登录体系;skill-zoo 分发走 GitHub,无自有 registry。
- 单 agent 复制安装:方向与 SSOT+symlink 相反,且连跨 agent 一次装都没有,完成度低于我们现有 CLI。
- 8-agent 内置表:小于 skill-zoo 现有 agent 覆盖,无增量。

整体:四仓中完成度最低(无 update、无锁、无批量、ROADMAP 与代码脱节),其 registry 中心化模式与 skill-zoo「文件系统为真相」正交,无可移植物。

## 5. 借鉴裁定

NOTHING: 完成度与设计感均低于 skill-zoo 现状(其缺失的 update/锁文件/跨 agent 安装恰是我们已有的),「CI 向」定位无代码实据,唯一亮点(validate 规范校验、schemars 生成)分别是规范照抄与工具箱常规操作,不过 90 分线。
