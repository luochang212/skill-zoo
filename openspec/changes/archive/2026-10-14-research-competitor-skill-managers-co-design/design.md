# Design(竞品 co-design)

研究输入:17 份竞品档案([evidence/dossiers/](evidence/dossiers/),16 仓本地浅克隆 + `gh skill` 文档研究),全部结论有 file:line 或官方文档 URL 支撑。本文档是综合裁定:哪些吸收、怎么落到 skill-zoo、哪些明确不要。

## 0. 门槛(90 分)与裁定纪律

吸收项必须同时满足三条件,缺一进 §3 拒绝清单:

- **(a) 原实现是 great**,也就是说完成度/设计感明显高于同类,有代码级证据,不是「有这个功能」;
- **(b) 架构兼容**,也就是说与「文件系统唯一真相、SSOT+symlink、Tauri IPC 边界、桌面拥有本地协议」不冲突,移植不引入架构腐蚀;
- **(c) 收益 > 成本**,也就是说收益用户可感知,且明显大于移植代价。

综合者对 17 份档案逐份复读后,裁掉两个「档案给了条件性吸收」的弱项的独立性(市场缓存降级、审计日志降级为待核查项,见 §2-H),并对两处档案间张力做出裁定:adopt 语义(§2-B)、tree-SHA 更新(§2-E)。

## 1. 横向结论(先于逐项)

1. **SSOT+symlink 是品类收敛形态,我方核心架构无需动摇。** chops(其 `SkillRegistry.swift:277` 注释将库位置称为 canonical location,并注明这匹配官方 skills CLI 行为)、chrlsio(`install.rs:38` "Canonical model")、jiweiyeah、skm 四家独立演化到「中央库 + agent 目录链接」;gh skill 官方更把 `.agents/skills/` 认定为 project 层 9 宿主共享目录(9 宿主解析到同一天然目的地时每技能只装一次)。
2. **CLI 赛道四家(asm/OpenPackage/skillfish/paks)无一强制 SSOT。** 它们最精巧的子系统包括 OpenPackage 双哈希 divergence 同步与 key 级合并卸载、skillfish sidecar 清单、asm disable-rename,全部都在治理「副本漂移」,一个我方已从根上消除的问题。**别把别的架构的药当自己的补品**是本次研究最大的反向收获。OpenPackage 的 40 平台能力矩阵还反证了 skills-only 范围的正确性:skills 是唯一在所有平台都有「每文件目录」语义的资源类型。
3. **官方信号明确:gh skill 的 install/publish/update 语义就是事实规范。** `@version`/`--pin` 是用户肌肉记忆,agentskills.io 校验清单可直接作为我方 preflight 验收基准。
4. **竞争主战场正从「装技能」(已同质化)移向两端:agent 自管理接口与信任**(风险扫描、审计日志、「这个 app 对我的磁盘做了什么」)。这恰是我方「桌面拥有协议 + 配套 CLI」优势的延长线。四家 GUI 竞品里只有 xingkongliang 把这件事做闭环了,而它是 ★6.3k 的那一家。

## 2. 吸收项 co-design

### A. ~~Agent 自管理协议(companion skill + CLI 机器接口)~~(已搁置,2026-10-14 产品评审)

CLI 机器接口(`--machine`/`schema`)当前没有真实的机器调用方,评审决定不做;而信封 + schema 是本主题的地基。没有稳定接口,companion skill 无物可教。故**整体搁置**,不是只砍一个 flag。触发条件:agent 自管理方向重新立项时,机器接口作为前置一并评估。以下分析留档。

**来源**:xingkongliang manage-skills 技能 + 桥接 CLI 发布(`cli_bridge.rs:88-212`)+ asm `--machine` v1 信封(`utils/machine.ts:21-52`)+ csm `schema` 自描述(`cli.py:670-795`)+ jiweiyeah companion 版本门控与 doctor 新鲜度检查(`doctor.rs:74-80`)。

**为什么 great**:四家从四个方向解同一道题,题目是「agent 如何安全地学会并驱动管理器」。xingkongliang 的 manage-skills SKILL.md 354 行全是决策规则(何时停、何时问用户、绝不代删),错误以 `{"ok":false,"code":"TARGET_CONFLICT",details.conflicts[].path}` 作为数据返回;asm 的信封是协议而非输出美化(v1 冻结 key、7 个稳定错误码、stdout 纪律:human chatter 强制走 stderr);csm 用一份手写 JSON 让 agent 零文档成本学会调用(`| head -c 4000` 注入上下文)。

**设计**:

- `packages/cli` 增 `--machine` 版本化信封 `{version, command, status, data | error{code,message,details}, meta}` + 错误码枚举 + stdout 纪律。additive,不触碰 npx skills 兼容语义。
- 增 `schema` 子命令:输出自描述 JSON(命令契约、SSOT/origin/symlink 概念、错误码表)。内容必须与 `docs/local-protocol.md` 同 change 更新,防止第二份漂移真相。
- 官方 companion skill(如 `skill-zoo-drive`):教 agent 用 `--machine` 驱动 CLI;含 NoClobber 语义(目标非本应用管理的部署时拒绝,`TARGET_CONFLICT` 结构化返回,收口动作指向 adopt);经理安装管线分发、无特权通道;版本与应用门控,doctor 检查新鲜度。
- CLI 增 `doctor` / `fix --yes` 二段式自检:诊断与修复显式分离,链接状态逐条 issue(expected vs actual),复用桌面 cache 重建逻辑,GUI 与 CLI 不出两套真相。

**协议影响**:触及 CLI 协议面,按 Local Protocol Guardrails 同 change 更新 `docs/local-protocol.md` + `fixtures/local-protocol/` + Rust/CLI 双端测试。

**开放问题**:① 是否需要 xingkongliang 式「发布 CLI 副本到固定路径 + stamp 三级失效」的桥接。若 companion skill 是唯一调用方,可在技能文档内写死探测命令,BRIDGE_BROKEN 状态机仅在走桥接路线时需要;② companion skill 走 skills.sh 公开包(xingkongliang 模式,仓库本身即合法 skill 包)还是仅随应用分发。

### B. ~~Adopt 孤儿收养~~(已撤回,勘误,2026-10-14 评审)

初版曾将 csm/xingkongliang 的 adopt 列为 P1 吸收项,并使用「origin=agent 技能是二等公民」的表述。**撤回该裁定**,理由有三:

1. **世界观移植错误。** adopt 是 csm 等竞品「一切技能必须住进我的库」世界观的产物;skill-zoo 的世界观(AGENTS.md、[产品哲学](https://www.luochang.ink/posts/skill_zoo/))把本地技能定义为一等 origin:「不隐式删除、移动用户的实际文件」是技术红线,SSOT 的主张方式是通过「不一致」面板暴露问题、由用户决策,而不是通过劝用户迁移文件。孤立存放在 agent 目录的技能**不是不一致状态**,主动提供「搬进 SSOT」按钮属于把自己的偏好强加于人。
2. **哲学兼容的收养已经存在。** `merge_duplicates_to_ssot`(`src-tauri/src/services/skill.rs:2097`)在「存在经内容校验的真实重复 + 用户显式确认」时执行 move-to-SSOT + 原位回链,这正是 adopt 的合法内核,且它只在该出现的地方出现(不一致解决流程内)。
3. **npx skills 兼容风险。** 按 `npx skills add` 规范安装在 agent 目录的技能是真实目录;将其迁入 SSOT 并回链后,官方 CLI 对该路径的 update/remove 行为未定义,违反 AGENTS.md「与 npx skill 保持兼容」的要求。

**保留价值**:若未来立项备份/多机同步(SSOT 是天然的同步单元),「把散落技能收进 SSOT」可作为该功能的一个显式选项,届时再评估。

### C. ~~安装期静态风险扫描~~(已否决,2026-10-14 产品评审)

未获得「规则当数据长期维护」的承诺;按三问检验不成立:检出率无数据支撑(大概率很低)、检出后果多为「触发不佳/权限偏宽」而非确定性损坏、检出后无内建对策(用户只能自行权衡)。触发条件:真实安全事件或反复出现的用户安全诉求。以下分析留档。

**来源**:jiweiyeah `risk/`(881 行规则 + 30 行 parser + 上下文降权 + 缓存,22+ 单测)+ asm 规则分类学(`security-auditor-scan.ts:22-265`,类别×严重度×permissionType 三维)。

**为什么 great**:两家独立收敛到同一个正确形态,即不是杀毒,而是**权限声明模型**(告诉用户「这技能会碰什么」);上下文降权(代码示例 0.3x、注释 0.5x、`SAFE_RM_TARGETS` 白名单)说明作者认真对待正则扫 markdown 的固有误报。四家 GUI 竞品中唯二有安装前扫描的,且都选择「报告不拦截」。

**设计**:Rust 侧安装 preflight 加静态分析:规则表按类别(shell/网络/凭证/文件系统/动态代码/混淆)×严重度×permissionType 组织,上下文降权,缓存键含 `scanner_version`(升级即失效);结果进安装确认对话框与技能详情。LLM 复审阶段不做。代价约 1-2k 行,纯本地只读计算,无协议影响。

**开放问题**:规则表的长期维护与误报反馈渠道(规则应做成数据而非散落代码)。

### D. ~~ComposePanel:AI 辅助编写 SKILL.md~~(搁置,触发条件:应用内编辑器出现真实使用数据)

**来源**:chops ComposePanel(全仓库完成度最高模块,1153 行;`ClaudeCLIAgent.swift:231` `--tools ""`)。

**为什么 great**:同类里唯一做到「AI 参与编写且人类有最终否决权」的闭环。协议设计聪明:显式禁用工具使 agent 只能回文本,杜绝绕过审阅直接写盘;复用用户已装 agent 的鉴权,零 API key 管理;`--print` 一次性调用而非常驻会话的收敛值得原样抄。

**设计**:编辑器内「让我的 agent 改这个技能」:Rust Tauri command spawn 用户已装的 `claude --print` / `codex exec`,流式转发 stdout;结构化 edits JSON 协议(失败回退围栏全文),LCS diff 呈现,人工批准后经应用管线写盘。成本 1-2 周。**硬约束:agent 只产文本,写盘永远走 Tauri 命令**(与 Tauri IPC 边界一致)。

### E. 官方语义对齐(gh skill),优先级 P2,与 upstream change 队列 B2(SHA 钉定)合并立项

**来源**:[gh-skill.md](evidence/dossiers/gh-skill.md)。

**吸收三点**(2026-10-14 以本仓代码实证后修正状态):

1. ~~`@version` / `--pin` 安装语法~~ **已裁掉(2026-10-14 产品评审)**:我们的更新流程是"检查展示变更 → 用户逐个主动升级","被偷袭升级"问题在交互层已不存在;批量更新同样经用户点击,钉定的边际收益(信噪比、供应链)不抵协议扩容(lock 加 `pinned_ref`)与概念负担。upstream 队列 B2(SHA 钉定)随之取消。若将来 agent 自管理(theme A)引入无人参与的批量更新,再重新评估。
2. ~~agentskills.io 校验清单进安装 preflight~~ **已否决(2026-10-14 产品评审)**:按三问检验不成立。绝大多数安装本就合规(检出率无数据但必然很低);检出的后果是「触发不佳」而非确定性损坏;检出后无内建对策(修复 = 用户自己在编辑器改,不缺安装时这一下)。另勘误:原评估称不合规 name「可能导致加载失败」**未经实证**。Claude Code 对不合规 name 的真实行为未验证,属夸大陈述。触发条件:支持渠道反复出现「技能从不触发」并归因于 frontmatter 时,一天量级即可补建。
3. ~~更新检测采用内容寻址(tree SHA)指纹~~ **已经实现,零工作量**:安装时 lock 的 `commit_sha` 字段写入的就是技能子树的 tree SHA(`cli.rs:1018-1034` `get_folder_sha_from_tree`),update 时比对新子树 SHA(`skill.rs:977`),机制与 gh 的 tree-SHA 语义相同。唯一残留是字段名 `commit_sha` 名不副实(改名属协议破坏,不建议;在 `docs/local-protocol.md` 写清语义即可)。不写入 frontmatter 的立场不变:拒绝 gh 的 provenance 污染。开放选项:只读识别 gh 写入的 `metadata.github-*` 以支持更新 gh 安装的技能,等钉定落地后按真实需求决定。

**档案间张力与裁定**:skillfish 档案判 tree-SHA 为「边缘优化」(我方已有 commit_sha 比对,`src-tauri/src/commands/skill.rs:978,1267`);gh 档案判为官方语义应对齐。裁定:以官方对齐为由吸收,但仅作为 upstream B2 立项时的语义参考(commit SHA → 子树内容寻址的精化),不单独立项。skm 的确定性目录哈希(`hash.go`)作本地修改检测的备选算法一并归档。

### F. ~~Plugin/marketplace 来源只读识别~~(已否决,2026-10-14 产品评审)

**不扫描插件市场是有意的产品决策,维持现状。** 即使将来要扫,插件技能也不得与 skills 混在一起呈现。skills 是 skills,plugin 是 plugin,两个管理平面不混合(harness 的插件归 harness,本应用只管 skills 协议内的技能)。以下分析留档,仅供将来重新评估边界时参考。

**来源**:superpowers(★299k 供给方完全不走 `~/.agents/skills/`,12 份 harness 插件清单锁步分发,技能落在 `~/.claude/plugins/` 等缓存目录)。

**为什么 absorb**:这是生态事实而非功能抄袭。SSOT 模型若对 plugin 来源失明,「文件系统是唯一真相」就有盲区:用户在 Local 页看不到这类技能,重名时不知 shadowing 存在。

**设计**:扫描层把 harness 插件缓存中的技能识别为独立只读 origin(如 `origin=plugin`),呈现为管理对象并纳入重名/shadowing 诊断;**绝不移动、不链接、不纳管**,原因是插件由 harness 自治。协议文档 + fixtures 同步。注意与「本地可见域」决策的交互:plugin 条目不应进入同名冲突一致性检查(同 external 的处理逻辑)。

**前置核查结果(2026-10-14)**:本仓 Rust 后端与前端对 `plugins`/`marketplaces` 目录**零覆盖**(全库 grep 无命中)。经 `/plugin install` 安装的技能在 Local 页完全不可见,shadowing 无法检测。缺口坐实,本项从「前置核查」转为确认的真缺口。

### G. ~~Attention budget / residency~~(搁置,零开发量的残余价值:安装确认文案可提示 description 常驻上下文成本)

**来源**:asm `stats --tokens` / `audit residency`(`stats-tokens.ts`、`residency.ts`)。

**为什么 great**:同类中唯一回答「装这么多技能,我的 context 账单是多少」。其原理是 description 常驻每条消息( resident),body 触发才付;数据不足的信号显式标 unavailable 而非静默丢弃。我方 symlink 模型让 demote(降级=摘链接)比 asm 的 rename hack 更干净。

**设计**:Rust stats 命令分别估算 resident/body,按 agent/scope 聚合,Local 页展示最重排行;demote 建议直接给可执行操作。

**开放问题**:token 估算是字符启发式,因此 UI 必须标注「估算值」,虚假精度比没有数字更糟。

### H. 运行卫生包(不独立立项,随 A/F 或维护 change 搭车)

- **watcher 自写回声抑制**:path-scoped 1.2s 静音窗口 + 外部编辑延迟上报不丢弃 + 单调钟(xingkongliang `file_watcher.rs:15-63`,纯函数可单测)。
- **Windows junction 链**:链接回退 symlink→junction(仍指向 SSOT,单一真相不破),受管拷贝+源路径标记(`.skills-manager-source.json` 式)为最后底线;**扫描侧必须识别 junction**(`symlink_metadata` 不报 junction,jiweiyeah `linker.rs:99-101`)。
- **原生读 SSOT 免链能力位**:agent 注册模型加 `reads_ssot_natively`,安装时只落 SSOT 不建链(chrlsio `install.rs:74-84`)。与 upstream change 的 Codex 路径跟进互证。两条独立证据链(上游 v1.7.2、chrlsio + gh 9 宿主矩阵)指向同一结论。需逐 agent 以官方文档坐实读取行为。
- **evidencePaths agent 检测**:用工具自身配置文件判断安装,而非探测 skills 目录(chops `AgentTarget.swift:19-60`)。
- **共享 canonical 目录冲突重复计数抑制**:一个 client 回落读另一 client 目录时不得重复报冲突(skill-station `reconcile.py:33-44`)。
- **Settings 展示 resolved 写入目标**:canonicalize 后与原始路径并排展示(skill-station /clients 页思路,展示细节)。
- **启停硬约束(反面教材)**:skm 的 DB 标志位 disable 不摘 symlink,骗不了 agent。若未来做 per-skill 启停,必须落在文件系统。
- **变更审计日志**:append-only、写路径收口落条、容量上限(skm `audit.go`)。前置核查:桌面+CLI 共写场景下「谁改的」目前是否有答案;纳入 CLI 侧需走协议流程。
- **市场缓存离线降级**:stale-while-error(chrlsio `cache.rs`)。前置核查:React Query 持久化是否已覆盖,已覆盖则勾销本项。

### 蓝图存档(不排期)

xingkongliang git 备份对象级三方合并(`merge/protocol.rs` + `decision.rs`,4.2k 行 + 1k 行集成测试):commit trailer 携带协议版本 + 树内粘性 protocol.json + 对象粒度纯函数决策(双端收敛)+ 冲突写 `refs/*/conflict/*` 不阻塞、决策可回滚。未来若立项备份/多机同步,两条硬约束先行:**冲突永不阻塞、决策可回滚**;协议要素(trailer/粘性协议文件/对象粒度)直接引用该档案。

## 3. 已评估并拒绝

| 来源 | 拒绝项 | 理由 |
|---|---|---|
| xingkongliang | Copy 同步为常态、junction 降级为 copy | 与「agent 目录只放软链接」冲突(§2-H 的受管拷贝仅作 Windows 最后底线,非默认) |
| xingkongliang | SQLite 为安装态第一真相 | 与文件系统真相相反;我方 cache 可弃可重建,无此负担 |
| xingkongliang | skills.sh RSC 载荷抓取、presets、Project Workspace | 前者脆弱,后两者是新功能面且 preset「一次性复制激活」制造第二真相 |
| jiweiyeah | hub 目录用户可选、AI 翻译技能内容 | 前者动摇协议决定的固定 SSOT;后者制造第二真相 |
| jiweiyeah | 4380 行单文件 marketplace.rs | 聚合思路 discover 已覆盖,代码组织不可学 |
| chrlsio | 目录名去重、覆盖式 `remove_dir_all` 安装、symlink 失败静默 copy | 三者都是数据模型错误/破坏无损性;连受管拷贝标记都没有 |
| chops | 单文件安装、makeGlobal 自动移动、RSC 爬虫、内存搜索、Collections | 分别是:功能残缺、越权移动用户文件、脆弱爬虫、O(n) 伪搜索、DB 第二真相 |
| chops/skill-station | SSH 远程管理面 | 另一个产品,超出本地优先边界 |
| skm | SQLite 双真相 + metadata JSON 双写、DB 标志位启停、groups、52 adapter | 双真相/伪禁用/后补抽象/广度注水 |
| skill-station | 两跳 vault(enabled/ 中间副本)、enabled.json 清单 SSOT、双写 Codex、mock 作为产品功能 | 链接指向副本致编辑不生效;清单 SSOT 冲突;把我方 SSOT 当 client 写;QA 手段非功能 |
| skills-tui | 全部 | 554 行启动器;GUI 代跑脚本/PTY 内嵌终端是安全与架构双输 |
| asm | 默认复制分发、library/activate 双轨、deps 租约、eval rubric、PR 式 registry、disable-rename、get 解析梯 | SSOT 已解复制病;第二中心库;复杂度超收益;启发式冒充评估;无自有 registry;copy 模型 hack;桌面 preview 已覆盖 |
| OpenPackage | 四类资源统一建模、流 DSL、双哈希同步、key 级卸载、registry 双层 | 均为复制架构伴生成本;40 平台矩阵反证 skills-only 正确;扩展资源类型=产品转型 |
| skillfish | sidecar 清单、manifest 团队同步、33-agent 目录探测 | 撞桌面自有协议(出处应走 lock 演进,非目录内双轨);团队场景未立项;目录存在≠可见性 |
| paks | 全部 | 完成度低于我方现状(无 update/锁/批量);「CI 向」无代码实据 |
| skill-man | MCP 配置管理、`.skill-man.json` sidecar、55-agent 表 | 写的是各 agent 私有活配置且无原子写入,「只管 skills 绝不动别的配置」是信任资产;sidecar 污染技能内容。**保留为需求信号**:Skills+MCP 统一管理痛点真实,若立项须以原子写+备份为前置 |
| csm | 多 source glob、绝对路径 symlink、target 自动发现、plugin 外壳 | 我方 SSOT 唯一;相对链接迁移更稳;Settings 可见性为准;绑定单一上游 |
| superpowers | 锁步版本化、marketplace 协议实现、bootstrap 注入 | 管理器非供给方;协议快速演化跟进无底洞;越出管理器职责 |
| gh skill | publish/release 流水线、frontmatter provenance、`--from-local` 复制、Code Search | 消费端不做发布;污染内容;我方本地技能绝不复制;桌面已有发现通道 |
| GenericAgent | 全部 | 技能沉淀是 prompt 纪律非代码机制,无确定性保证可移植;佐证「管理器收拢散落技能」的产品判断 |

## 4. 转出 change 队列(已于 2026-10-14 产品评审后全部否决/搁置,当前无待立项项)

1. ~~agent 自管理协议~~ 搁置(§2-A):机器接口无近期调用方;随 agent 自管理方向整体重新评估。
2. ~~安装期静态风险扫描~~ 否决(§2-C)。
3. ~~ComposePanel~~ 搁置(§2-D),待编辑器真实使用数据。
4. ~~gh 语义对齐~~ 解散(§2-E):钉定已取消、校验器已否决、tree-SHA 更新经实证已有。
5. ~~plugin 来源只读识别~~ 否决(§2-F)。
6. ~~attention budget~~ 搁置(§2-G)。
7. 卫生包(§2-H):非常驻队列,碰到对应代码时按条目顺手处理;两项前置核查(审计日志现状、React Query 持久化)保留为随手核查。

~~adopt 孤儿收养~~ 已撤回,见 §2-B 勘误。

## 5. Open Questions 汇总

1. §2-A:CLI 桥接发布 vs 依赖 npm 安装;companion skill 分发通道(随应用 vs skills.sh 公开包)。
2. §2-C:风险规则表的维护策略与误报反馈渠道。
3. §2-E:是否只读识别 gh 写入的 `metadata.github-*`(决定能否更新 gh 安装的技能)。
4. §2-F:`origin=plugin` 对本地可见域与冲突一致性检查规则的影响(AGENTS.md 同步修订点)。
