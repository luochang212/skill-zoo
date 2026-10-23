# xingkongliang/skills-manager(★6287|Rust+React 19/Tauri 2|2026-10-13 push|MIT)

## 1. 定位与架构(实证)
一句话:跨 54 个 agent 的技能库管理器,中央库 + 按 agent 部署 + git 备份多机同步,桌面与 CLI 共享同一 Rust core。

- 技术栈:React 19 + TS + Vite / Tauri 2 / rusqlite(bundled)(README "Tech Stack" 表;src-tauri/Cargo.toml:31)。
- SSOT 模型:中央库默认 `~/.skills-manager/skills/`(可迁移,central_repo.rs:236 base_dir),实体文件在中央库;agent 目录默认 symlink,Windows 无符号链接权限时降级 junction,显式 Copy 模式按 source_hash 跳过无变化重拷(sync_engine.rs:260-409;migrations.rs v5→v6 注释引 issue #153)。与 skill-zoo 差异:它允许 Copy 模式且为用户本地技能提供 adopt(收编复制),不是"绝不复制"。
- 真相方向:SQLite 存 skills/skill_targets/scenarios/projects/audit_log 等(migrations.rs:50-120),但启动时从中央库 `.skills-manager/` 元数据目录 reindex(sync_metadata.rs:82,117-121 reindex_from_metadata)。元数据目录作为 git 传输投影,随库走。README:"SQLite database is not in Git — rebuilt from the skill files"。
- 形态:桌面 app(Tauri)+ 同 crate `[[bin]]` 的 skills-manager-cli(bin/skills-manager-cli.rs:14 与桌面共用 core:同一 SQLite、同一 sync_engine、同一 RepoLock)。
- 技能来源:Git 仓库/本地目录/.zip/.skill 归档/skills.sh 市场(well_known.rs 解析 skills.sh /site/ 页并校验 sha256 digest,well_known.rs:81-286)。

## 2. 功能清单
- 中央库安装/删除/标签/批量操作 [完整] commands/skills.rs(4545 行)。
- 多 agent 部署(symlink/junction/copy)+ 卡片 agent badge 实时状态 [完整] sync_engine.rs;目标不可写时 per-target status/last_error 落库。
- NoClobber 防护:目标目录非自己管理的部署时拒绝,`TARGET_CONFLICT` 结构化错误带 conflicts[].path,`skills adopt --dry-run` 收编 [完整] sync_engine.rs:154,846-870;manage-skills SKILL.md "When a deployment is refused" 段(issue #363 曾发生误删用户目录,此为修复)。
- Git 备份 + 多机同步 [完整]:GitHub device-flow 登录建私有仓库,token 进 OS keychain(commands/git_backup.rs;crypto.rs);对象级三方合并(见 §3)。
- Presets(=scenarios,兼容旧名)[完整] commands/presets.rs;激活是一次性复制非 live sync;preset 元数据含 per-tool enabled map 写入元数据目录随 git 备份(sync_metadata.rs ScenarioSkillMetaFile)。
- 文件 watcher [完整] file_watcher.rs:notify 监听中央库+各 agent 目录,自写回声抑制(path-scoped mute 窗口 1.2s、monotonic 时钟、外部编辑 deferred 不丢弃,:15-63),500ms debounce + 3s 重扫,发 `app-files-changed`。
- 更新追踪 [完整] skills 表 remote_revision/update_status + skill_auto_updater 后台循环。
- 桥接 CLI 发布 [完整] cli_bridge.rs(见 §3)。
- manage-skills 技能 [完整] skills/manage-skills/SKILL.md(354 行,内容极其克制精确)。
- 审计日志/导出日志 zip、托盘、代理、i18n、应用内更新 [完整]。
- Project Workspace(项目本地技能目录与中央库双向对比同步)/ Linked Workspace [完整] commands/projects.rs。

## 3. 借鉴候选(90 分门槛)
1. **桥接 CLI 发布协议(stamp 文件 + 三级失效 + BRIDGE_BROKEN)**
   - 是什么:解决"agent 如何在无 PATH 配置下找到 CLI"。app 启动把 bundle 内 CLI 拷到 `~/.skills-manager/bin/`,`--version` 实测通过且版本全 token 相等后才写 `.version` 戳;publish 前 stamp 先删,删不掉则截断,再不行删二进制(cli_bridge.rs:88-117 invalidate_bridge 三级 fallback,:182-212 verify)。
   - 程度:半成品不可能写出这种防御。注释逐条解释 Windows 锁文件/AppImage 挂载路径/#363 旧二进制会删数据,SKILL.md 端定义 BRIDGE_BROKEN 状态机并禁止 agent 自行找替代 CLI(skills/manage-skills/SKILL.md:22-40)。
   - 为何 great:把"分布式系统中无法原子替换的文件"问题用最少的机制(stamp last-written-first)解干净,且两端(SKILL.md 与 Rust)严格闭环。
   - 落点:skill-zoo 的 CLI(packages/cli)+ 桌面协议。落点在 src-tauri 启动流程 + CLI 侧检测逻辑;代价小(百行级);与"桌面拥有本地协议"完全同向,无冲突。
2. **manage-skills:官方技能让 agent 反向驱动应用**
   - 是什么:仓库自带 `skills/manage-skills`,Dashboard 一键装到选定 agent(AgentControlSetupCard.tsx:14-16 直接用自家 GitHub URL 走常规安装路径,零特殊机制);技能教 agent 用 `--json` 驱动 CLI,库/部署/preset 三态分离,错误以 `{"ok":false,"code":"TARGET_CONFLICT",details.conflicts[].path}` 作为数据返回。
   - 程度:SKILL.md 354 行全是决策规则(何时停、何时问用户、绝不替用户删),且 `npx skills add xingkongliang/skills-manager` 可独立安装,也就是说仓库本身即是合法 skill 包。
   - 为何 great:解决了所有技能管理器的共同难题(agent 绕过管理器直写 agent 目录破坏元数据),且发布机制复用自家安装管线,无任何特权通道。
   - 落点:skill-zoo 已有 CliService(Rust 重实现 npx skills)。可在 packages/cli 或独立 skill 包加"drive skill-zoo"技能,发布路径同上;与 SSOT 协议一致(部署走同一 deploy 代码),无架构腐蚀。
3. **Git 备份的对象级三方合并协议(commit trailer + 纯函数 decision + conflict refs)**
   - 是什么:多机同步合并以"技能对象"为粒度而非文本行。每个 app commit 带 `Skills-Manager-Protocol: 2` trailer + 树内粘性 `.skills-manager/protocol.json`(merge/protocol.rs:16-24,60-79);decision 是三快照的纯函数保证双端收敛(merge/decision.rs:1-8,84+);冲突不阻塞。发生冲突时本地版本保持、`refs/skills-manager/conflict/*` + pending_conflicts 表投影(migrations.rs v6→v7),用户选 keep mine/use remote/keep both,选择前自动快照。
   - 程度:merge/ 共 4.2k 行 + 1k 行集成测试,注释引用自成一体的 merge-engine design 章节(§3/§4/§6/§10)。完成度远超同类(其他竞品基本无多机同步)。
   - 为何 great:协议设计(trailer 检测旧客户端、幂等收敛、冲突可回滚)是教科书级;这正是"文件系统是真相"架构的自然延伸。
   - 落点:skill-zoo 若做多机备份,这是设计蓝图而非移植代码,吸收方式是取其协议要素(trailer+粘性协议文件+对象粒度决策+冲突 ref),落 src-tauri 新模块。代价高(需独立 openspec change);当前不阻塞,但其"冲突永不阻塞"与"决策可回滚"这两个协议要点值得作为硬约束写进未来设计。
4. **watcher 自写回声抑制(path-scoped mute + defer 不丢弃)**
   - 是什么:app 自己的写入会触发 watcher 风暴;按路径记 1.2s 静音窗口,窗口内真实外部编辑延迟上报而非丢弃,单调钟防墙钟跳变(file_watcher.rs:15-63)。
   - 程度:纯函数 decide_emit/muted_at 可单测(:108-125);引用 issue #248 的真实风暴。
   - 落点:skill-zoo 文件系统真相 + cache 重建同样依赖 watcher;落 src-tauri watcher 模块,代价小。与架构无冲突。

## 4. 明确不借鉴(带理由)
- Copy 同步模式与 junction 降级:与 skill-zoo "agent 目录只放软链接、绝不复制"的决策正面冲突;Windows 无符号链接问题应另行解决而非引入分叉副本。
- skills.sh 市场抓取(Next.js `self.__next_f` 载荷解析,skillssh_api.rs:270):hacky 且依赖站点内部格式,skill-zoo 已有自己的 discover 通道。
- SQLite 作为安装态的第一真相(skill_targets 为权威、文件为投影):与 skill-zoo"文件系统唯一真相、cache 可弃可重建"方向相反;它用元数据目录对冲,我们没有这个负担。
- Presets/scenarios/Project Workspace:完整但属新功能面,skill-zoo 未提出该需求;且 preset"一次性复制激活"语义会制造第二真相。
- 审计日志、导出 zip、托盘、代理、i18n:常规工程,无独到设计。
- Update tracking:table stakes。

## 5. 借鉴裁定
ABSORB: 桥接 CLI 发布协议(stamp+三级失效+BRIDGE_BROKEN);manage-skills 官方自管理技能(含 --json 错误即数据协议、NoClobber/adopt);git 备份对象级合并协议(作为未来备份功能的设计蓝图吸收:trailer+粘性 protocol.json+纯函数收敛+冲突不阻塞);watcher 自写回声抑制(path-scoped mute)。
