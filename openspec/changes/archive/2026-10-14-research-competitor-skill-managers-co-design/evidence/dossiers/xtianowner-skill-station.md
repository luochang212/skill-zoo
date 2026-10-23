# xtianowner/skill-station(★0|Python/FastAPI + Next.js 15|2026-05-12|MIT)

## 1. 定位与架构(实证)

一句话定位:本地优先的 vault 型技能管理器。`~/skills-vault/` 内 own/community 存源,enabled.json 清单记录用户意图,经 symlink/copy 双后端"投递"到各 client 目录。

技术栈:FastAPI(127.0.0.1:7321)+ Next.js 15 前端(两个进程,非桌面 app);文档密度高(docs/plan、design-decisions、audit 各一篇)。

SSOT/分发模型:**三段式**,即源(vault own/community,git 友好)→ `enabled/` 中间副本(每台机器的投递工件,gitignore,`ops.py:58-67` copytree)→ client 目录(symlink 或 copy 指向 enabled/)。SSOT 声明是 `enabled.json` 清单(manifest.py:11-17),文件系统不是唯一真相,清单是。关键差异:两跳模型里 symlink 指向的是 enabled/ 副本而非源,用户改 own/ 后**不会**自动生效,需 resync(`ops.py:247-253` = disable+enable),这与 skill-zoo"链接必须指向真实文件、编辑即时生效"的原则冲突。disable 按 last_delivery 日志逐个摘除(`ops.py:202-244`),完整 disable 连 enabled/ 副本一并删。

形态:CLI(sks)+ 浏览器 GUI。技能来源:own 手写 + community 仓库(git_ops 在 roadmap,尚未实现)+ scan-clients 反向扫描。

## 2. 功能清单

- vault 初始化(own/community/enabled/ARCHIVED + .gitignore + enabled.json)[完整] `ops.py:16-35`
- enable 投递:前置冲突检查 → 三分支(backup_and_overwrite/skip/abort 返回结构化 conflicts)[完整] `ops.py:100-199`
- 冲突分型:equivalent(已链向同源→幂等 ok)/symlink(链向他处)/directory/file,目录冲突附 hash [完整,质量高] `deliver/symlink.py:10-25`, hash_dir `deliver/base.py:24-39`
- 覆盖前备份:整体归档到 `ARCHIVED/<ts>-deliver-backup/`,symlink 以 `.symlink.txt` 记录指向再删 [完整] `ops.py:78-97`
- canonical path 解析透明化:每个 target 路径 resolve 后与原始路径并排展示,/clients 页列出 dir≠canonical 的"重定向"[完整] `ide_targets.py` resolve_canonical + `frontend/src/app/clients/page.tsx:29-46`
- mock 模式:`SKS_MOCK_TARGETS_DIR` 一个环境变量把全部 client 目录重定向到 /tmp,真实 app 全链路可测/可演示 [完整] `ide_targets.py:30-42`
- reconcile Stage 1:只读把 全库×client×清单×hash 分成 12 个 case,含共享目录误报抑制(opencode 回落读 claude 目录,`reconcile.py:33-44` shared map)[半成品] `reconcile.py:66-150` 的现状是**只有分类和首页 banner,adopt/import/drift-fix 等 mutation 全部未做**(Stage 2/3 roadmap)
- Codex 双写(~/.codex/skills + ~/.agents/skills)与 OpenCode 共享目录建模(client notes 字段)[完整] `ide_targets.py`
- SKILL.md 校验(name 合法性等,invalid 拒绝 enable)[半成品] `scanner.py:41-55`
- 社区仓库安装 UI:未实现(roadmap git_ops)

## 3. 借鉴候选(90 分门槛)

无。核心工程手段(投递前备份、canonical 比较、HOME 覆盖测试)skill-zoo 已有等价或更强实现:staged backup/restore 见 `skill-zoo src-tauri/src/services/skill.rs:80-87`(.name.backup. 命名空间);TEST_HOME 线程局部 HOME 覆盖见 `src-tauri/src/config.rs:474-479`;Windows junction 的 canonical 比较见 `services/skill.rs:293-326`。余下候选逐条不过线,见第 4 节。

## 4. 明确不借鉴(带理由)

- vault 两跳模型(enabled/ 中间副本):symlink 指向副本导致编辑不即时生效、需要 resync 闭环节点,这正是 skill-zoo"单一真相、链接指向真实文件"要避免的分歧源。
- enabled.json 清单为 SSOT:第二真相源,与"文件系统是唯一真相"冲突;skill-zoo 靠重建缓存已覆盖其意图记录功能。
- reconcile 12-case:想法好实现烂的典型,具体表现为只读分类 shipped,修复动作零实现;且 skill-zoo 的 visible-local-scope 冲突规则(AGENTS.md)语义上已覆盖其大半。唯一值得记一笔的边角:**共享 canonical 目录的重复计数抑制**(opencode 回落读 claude 目录时不该报冲突)。
- mock 模式作为特性:skill-zoo 已有 TEST_HOME 覆盖 Rust 单测;残余价值仅在"真二进制+GUI 的端到端演示",属 QA 手段非产品功能,Tauri 侧用 debug 启动参数即可随时补,不值得立项。
- 双写 Codex(~/.agents/skills 作为投递目标):把 skill-zoo 的 SSOT 当作普通 client 目录写,协议打架;skill-zoo 的 ~/.agents/skills 语义不容他人(也不容自己)双写。
- 覆盖前 ARCHIVED 备份:skill-zoo staged install 已有等价物,且 skill-station 自己的备份失败会静默返回 None(`ops.py:95-96`),实现并不更严谨。
- /clients 页 canonical 透明化:想法可取(让用户知道真实写入目标)但只是设置页展示细节;skill-zoo Settings 展示 agent 路径时补一行 resolved 目标即可,不值一个候选格。

## 5. 借鉴裁定

NOTHING: 其两个招牌工程手段(备份后覆盖、路径规范化)skill-zoo 已有等价实现,而它的架构主体(vault 清单 SSOT + enabled/ 中间副本)与"文件系统是唯一真相"正面冲突,剩余可取处仅为边角(共享目录冲突抑制、canonical 展示),并入现有逻辑即可。
