# knoxgraeme/skillfish(★324|TypeScript|2026-08-05|AGPL-3.0)

## 1. 定位与架构(实证)

一句话定位:「一条命令装到所有检测到的 agent」的轻量技能管理器。`npx skillfish add owner/repo` 零安装起步,外加 skill.fish 目录站与团队 manifest 同步。

技术栈:TypeScript + commander + @clack/prompts + giget(tarball 下载);非测试源码仅 636 行,vitest 测试;附遥测(detached worker,`DO_NOT_TRACK`/`CI` 退出,README.md:407-433)。

SSOT/分发模型:**复制到每个检测到的 agent,无 SSOT 无链接**。`installSkill` 对 agents 循环 `safeCopyDir`(src/lib/installer.ts:189-304);来源是 giget 拉 tarball 到临时目录。唯一的状态载体是**每个技能目录内的 sidecar 清单** `.skillfish.json` v2(src/lib/manifest.ts:40-59):`{version,name,owner,repo,path,branch,sha(tree SHA),ref,source:'manifest'|'manual'}`,temp+rename 原子写(:99-118),内容严格校验防篡改触发意外 API 调用(:248-315),v1→v2 自愈迁移(:163-240)。冲突时存在即跳过,`--force` 才覆盖;覆盖走 backup+rename,失败回滚,EXDEV 降级(installer.ts:205-234,281-303)。

形态:npm CLI;技能来源:GitHub repo(任意子路径)、skill.fish 目录(`submit` 人工审核收录)。

## 2. 功能清单

- [完整] 33 agent 数据驱动检测:`AGENT_CONFIGS` 声明 homePaths/cwdPaths(检测的是 agent 配置痕迹而非技能目录,如 Cursor 靠 `.cursor/extensions`/`argv.json`,src/lib/agents.ts:22-231),global/project/both 三种检测语境(:283-304),globalDir 与 dir 分离(Windsurf 全局装到 `.codeium/windsurf/`)
- [完整] `add`:自动发现 SKILL.md/按名/按路径/`--all`;默认装到全部检测到的 agent,`--agent` 按名过滤(大小写不敏感去重,agents.ts:310-337)
- [完整] 安全复制:`safeCopyDir` 跳过一切 symlink,双重 lstat 缩小 TOCTOU 窗口(installer.ts:84-125);分支名合法性校验防 giget 语法注入(:49-54)
- [完整] `update`:tree SHA 比对,具体做法是按 manifest 记录的 repo 递归 tree 匹配技能子路径的 SHA,子树没变不算 outdated(update.ts;manifest.ts:52-54);`--json` 不带 `--yes` 是 check-only 模式(README.md:341);批量并发 `batchMap`
- [完整] 团队同步:`skillfish.json` 项目清单(v1,字符串条目 `owner/repo[@ref][/path]`,project-manifest.ts:23-29)→ `install` 同步:装缺失、ref 变更则更新、**移除不再列出的 manifest-managed 技能**;manual/untracked 技能受保护不删(install.ts:310-340);每次删除前重读清单防竞态(:755-773);`--dry-run` 预览
- [完整] `bundle`:从已装技能反扫生成清单,本地 init 的技能排除(版本控制内,README.md:266)
- [完整] `--json`:`{success,exit_code,errors,...命令字段}`(README.md:347-357)+ 全命令统一退出码 0-4(README.md:361-369)
- [完整] token 链:`SKILLFISH_GITHUB_TOKEN`→`GITHUB_TOKEN`→`GH_TOKEN`→`gh auth token`(README.md:298-304)
- [摆设] `search`:纯查 skill.fish 站点 API,无本地索引

## 3. 借鉴候选(90 分门槛)

无。三个最强点(sidecar 清单、tree-SHA 更新、manifest 同步)分别倒在门槛 (b) 或 (c),见第 4 节。

## 4. 明确不借鉴(带理由)

- **技能目录内 sidecar 清单(`.skillfish.json`)**:设计动机与我们一致,都是让出处跟着文件走、可从文件系统重建。但落点与桌面自有本地协议冲突:skill-zoo 的出处已由桌面拥有的 lock 承载(skills 来源/commit_sha),把出处写进技能目录会污染 SSOT 中用户可见/可 git 提交的技能目录,且制造第二份真相。若嫌 lock 不够「文件系统真相」,正解是协议内演进,不是引入 sidecar 双轨。
- tree-SHA 更新检测:比 commit-SHA 更准(多技能仓库中别的子树变了不再误报 outdated),实现干净。但 skill-zoo 已有 commit_sha 比对与跳装(src-tauri/src/commands/skill.rs:978,1267),这只是边缘优化,收益不足以立项;若未来用户抱怨误报可再捡。
- manifest 同步(managed/manual 保护 + stale 移除):语义设计(谁可被自动删)是这份代码里最想清楚的部分,竞态重读也周到;但引入 `skillfish.json` 型项目清单=本地协议扩容,而团队共享场景 skill-zoo 桌面端尚未立项,伪需求暂不成立。
- 33-agent 配置痕迹检测:skill-zoo 的 agent 可见性由 Settings 显式管理(可见局部作用域),比「目录存在即算」更符合桌面产品语义;检测表本身两边已有等价物。
- backup+rename 覆盖安装:skill-zoo 走原子协议事务(persistence/agent_transaction),问题已解。
- 遥测:直接违背产品哲学。
- `{success,exit_code,errors}` JSON:被 asm 版本化信封全面取代。

备注:这是四仓中「每行代码工程密度」最高的(TOCTOU 双检、防篡改校验、竞态重读、EXDEV 降级都出现在 636 行里),可作为代码评审基准参考,但无功能可吸收。

## 5. 借鉴裁定

NOTHING: 其三项招牌(sidecar 清单、tree-SHA 更新、manifest 团队同步)分别是好想法撞上协议冲突、现有机制的边缘优化、超前于需求的协议扩容;工程质量高但无一项同时满足 great、架构兼容、收益>成本。
