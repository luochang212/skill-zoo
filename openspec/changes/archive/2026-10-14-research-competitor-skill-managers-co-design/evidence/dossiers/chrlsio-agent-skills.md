# chrlsio/agent-skills(★300|Rust + React 19/Tauri 2|2026-04-09 push|MIT)

## 1. 定位与架构(实证)
一句话:与 skill-zoo 同构的轻量管理器。它以 `~/.agents/skills/` 为 canonical 位置 + agent 目录 symlink,纯扫描无技能数据库,叠加 skills.sh/ClawHub 双市场。

- 技术栈:React 19 + TS + Tailwind 4 / Tauri 2 / Rust;SQLite 仅用于市场缓存(README Tech Stack;marketplace/cache.rs:16-24)。
- SSOT 模型:install = 复制进 `~/.agents/skills/<name>/`(canonical,install.rs:38-43 注释"Canonical model")→ 对每个目标 agent 建软链;若 agent 经 `additional_readable_paths` 原生读取 `~/.agents/skills` 则**跳过软链**(install.rs:74-84)。技能状态零落库,启动时扫描所有 agent 目录 + 共享目录,canonicalize 解链后按目录名去重(engine.rs:60-75 scan_all_skills 注释)。
- 出处追踪:共享目录下单文件 `.provenance.json`(skill_id → source/repo_url),安装写入、卸载移除,扫描时回读(install.rs:324-373)。
- 形态:纯桌面 app,无 CLI。
- 技能来源:本地目录、Git(git2)、skills.sh(RSC 抓取)与 ClawHub(API)。
- 与 skill-zoo 的关键差异:安装到 canonical 前 `remove_dir_all` 已存在同名目录,无冲突检查(install.rs:139-145);symlink 失败静默降级 copy,仅 eprintln(install.rs:150-160)。两者都破坏"文件系统真相"的无损性;去重键是目录名(engine.rs:112-114 注释"Dedup key = directory name"),两个不同 agent 下同名异技能会被错误合并。已 6 个月未更新。

## 2. 功能清单
- 16 agent 支持,定义外置为 TOML 注册表(src-tauri/agents/*.toml:slug/name/global_paths/cli_command/install_command/install_docs_url/skill_format/additional_readable_paths/extra_config) [完整] registry/loader.rs:11-40(加载 + ~ 展开 + 按 slug 排序)。
- agent 检测三级:CLI 命令存在 → detect_paths → 应用包存在(loader.rs:57-62) [完整]。
- 原生读取共享目录的 agent 跳过软链 [完整] install.rs:74-84;codex.toml/gemini-cli.toml 均声明 `additional_readable_paths = ~/.agents/skills`。
- agent 专属安装钩子:extra_config 模板(Handlebars)渲染到目标配置文件(如 Gemini 扩展注册) [完整] install.rs:90-103。
- 跨 agent 一键同步/批量 [完整] 前端 SkillAgentList/SkillsManager。
- 文件 watcher:notify 递归监听各 agent 目录 + 共享目录,过滤 metadata-only 事件,500ms debounce,发 `skills-changed` [完整] watcher.rs:60-104(注意:无自写回声抑制,自己安装也触发全量刷新)。
- 市场聚合:skills.sh 抓取 HTML 内 Next.js RSC 载荷(marketplace/skillssh.rs:42-49)+ ClawHub API;SQLite 缓存带过期时间,网络失败时 `read_cache_stale` 降级返回旧数据(skillssh.rs:9 use;cache.rs:41+) [完整]。
- SKILL.md 应用内编辑/预览、导入向导、i18n、主题 [完整]。

## 3. 借鉴候选(90 分门槛)
1. **"原生读取 SSOT 的 agent 免链"能力位(additional_readable_paths)**
   - 是什么:agent 定义区分"需要软链才能看见技能"与"自己就读 `~/.agents/skills`";后者安装时只落 SSOT,不建链(install.rs:74-84)。
   - 程度:安装路径与注册表数据两端闭环,codex/gemini 等 TOML 均有声明;扫描侧对应实现 inherited 视图(engine.rs:77-145 scan_inherited_root)。
   - 为何 great:生态正在向 `~/.agents/skills` 收敛(skill-zoo 的 SSOT 选择押对了);对原生读取者仍建链会让同一技能在该 agent 内出现两次(自己的目录 + 共享目录各一份),免链是唯一正确行为。这是协议级洞察,不是 UI 细节。
   - 落点:skill-zoo 的 agent 注册模型加一个能力位(如 `reads_ssot_natively`),install preflight 与 link 创建处各加一个分支;扫描/detect 侧把它纳入可见性判定。代价很小;与 SSOT+symlink 决策完全同向(它是对该决策的必要精化,防止自指软链/双重可见)。需在 skill-zoo 侧逐 agent 验证真实性(读取行为以官方文档坐实)。
2. **市场缓存 stale-while-error 降级**
   - 是什么:市场列表带 TTL 缓存,网络失败时返回过期数据并在 UI 层可标注(cache.rs read_cache_stale;skillssh.rs:44-46 先查缓存)。
   - 程度:实现完整且小(单文件);属于工程好品味但规模有限。
   - 为何 great(勉强达标):对桌面应用的"离线也能浏览已见市场"是用户可感知的韧性,代价极小。
   - 落点:skill-zoo 的市场/discover 查询层(React Query 本身有 staleTime,但持久化离线缓存需本地落盘);可作为一个小改进项。若 skill-zoo 的 React Query 已配持久化,则此项自动满足,无需单独移植。

## 4. 明确不借鉴(带理由)
- 按目录名去重合并(engine.rs:112):同名异技能会互相吞并,是数据模型错误,skill-zoo 的可见域一致性检查更严谨。
- 安装覆盖式 `remove_dir_all`(install.rs:139):无冲突检查,可能摧毁用户在 canonical 的同名技能;skill-zoo 的 preflight 冲突检查是正确做法。
- symlink 失败静默 copy(install.rs:150-160):破坏 SSOT 且无任何标记/追踪,连 jiweiyeah 的"受管拷贝+源标记"都不如。
- agent TOML 外置注册表整体形态:方向合理(加 agent = 加文件),但对 skill-zoo 是一次无迫切需求的重构;除非 agent 适配频率高到 Rust 注册表成为瓶颈,否则违反最小改动。
- skills.sh RSC 抓取(skillssh.rs):依赖站点内部序列化格式,脆弱;xingkongliang 同样做法,skill-zoo 已有自己的通道。
- extra_config 安装钩子(Handlebars 模板写 agent 配置文件):真实需求但当前 skill-zoo 未覆盖此类 agent;等有具体 agent 需求再议,避免预设计。
- 无出处/无锁的 `.provenance.json` 单文件:并发安装会互相覆盖整文件,不如 skill-zoo 现行方案。

## 5. 借鉴裁定
ABSORB: agent 能力位"原生读取 SSOT 免链"(协议级小改,防双重可见);市场缓存离线降级(若现有查询层无持久化缓存则作为小改进)。
