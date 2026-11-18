# 2026-11-19 全仓 review 的 worth-fix 分诊

来源：2026-11-19 全仓 review（五路深审：Rust 持久层、Rust services/commands 层、前端、CLI/协议 fixtures、文档/ADR/site；另含 CI workflow 与 Tauri capabilities 自查）。本文件对每条发现做"属实程度"与"值得修"双重判定。与 2026-11-18 triage 重叠的条目沿用其裁决，只在新证据出现时重开。

## 验证方法与边界

- **运行时实证（真实 CLI，`--home` 隔离）**：imports re-import 丢未知字段（seed `futureOptional` → re-import → grep = 0）；journal 三种形态的恢复行为（内容型数组保留、空数组删除）。git 实证：`git merge-base --is-ancestor next/own-protocol main` 退出 1，同内容改动以 `89b22f3` 重新落地。
- **代码级逐行核对（约 35 条）**：全部 P1、全部 Rust P2、前端 P1/P2、CI 项、ADR 引用漂移（`junction::create` 实际在 skill.rs:1951，ADR 8 写 2114；`report_missing_baseline` 在 cli.rs 已不存在）。
- **结构验证（review agent 读码 + 本轮抽验）**：其余 P2/P3。CLI agent 对 SSOT-resident import、plugin 缓存清除、JSON envelope 死代码三项做过实证复现，本轮未重复。
- **未实测**：跨进程竞态（history 无 lease 并发写、remove_skills 与 watcher 重建交错）、`setTimeout(…, Infinity)` 的浏览器 clamp 行为（机制由文档化库行为支撑）、watcher 事件时序窗口。

### 复现事故与教训

首轮 CLI 复现用 `HOME=<scratch>` 环境变量隔离，但 Bun 的 `os.homedir()` 在 macOS 不读 HOME，CLI 写入了真实的 `~/.skill-zoo/imports.json` 并在 6 个 agent 目录创建悬空链接。已用 CLI 自身能力完整清理（`imports remove` + `imports clean`，imports.json 恢复为空、无残留链接）。教训：**CLI 复现必须用全局 `--home` 选项，复现后必须核对真实状态文件**。

## 判定总表

编号 F=前端 R=后端 C=CLI D=文档 CI=基础设施。

### 立即修（高影响 + 低成本，一个自然批次）

| # | 发现 | 属实程度 | 一句话理由 |
|---|------|---------|-----------|
| R1 | `parse_repo_query` 截断斜杠分支名（`github.rs:186-201`，`segments[3]` 只取一段，`tree/feature/x` → `feature`） | 坐实（逐行核对） | `feature/x` 分支极常见；lock 记错分支、更新流全错、全程静默。修 = join `segments[3..]`，一行级 |
| C1 | CLI re-import 丢弃 imports.json 逐条未知字段（`imports.ts:347-360` 全新 5 字段 entry 覆盖旧 entry） | **实证坐实**（真实 CLI 复现） | 协议文档明文"read-modify-write 必须保留未知字段"；2026-11-18 已给桌面端补过同类 serde 保留，CLI 写路径漏了。修 = spread `...existingEntry`，一行 |
| R3 | watcher 增量路径不过滤 `.install.`/`.backup.`/`.update.` staging 目录（`watcher.rs:263-269` 只有 `.tmp` 后缀 + SKIP_DIRS；全量扫描的 `is_app_temp_dir` 有三件套），≥1.5s 拷贝间隙即可把 staging 目录 upsert 成幽灵 skill 并广播 `skills-changed` | 坐实（逐行核对） | 过滤谓词两份实现是温床（见温床 2）；增量路径复用 `is_app_temp_dir` 即收敛 |
| R7 | `remove_skills` 不持 `cache_refresh_lock`，与 watcher 全量重建交错可复活幽灵条目（merge/archive 均持锁，唯独它没有） | 坐实（agent 结构验证，我核对调用点） | 补一行持锁即与既有模式对齐；不需要重构 |
| R17 | restore 嵌套 home skill 会新造平铺 symlink（archive 侧 `skill_archive.rs:449-459` 有 skip，restore 侧 `:673-717` 无镜像 skip；roundtrip 测试覆盖该 fixture 但没断言平铺链接不存在） | 坐实（restore 侧逐行核对） | 归档前后物理身份不对称，agent 会看到同一 skill 两次；修 = 镜像 skip + roundtrip 测试补断言 |
| F1 | Skill Usage 对话框硬编码英文三处（`SkillCompanionSettings.tsx:528` footer、`:126`/`:181` 有现成 `usageCalls` key 却未用） | 坐实（逐行核对） | 违反自家 i18n 不变量，中文用户在常驻 footer 看到英文；现成 key 已存在 |
| D1 | AGENTS.md 分支权威性段落"fast-forward 回 main"与 git 拓扑不符 | **git 实证坐实** | 一句话改写（re-landed as `89b22f3`，分支留作参考）；贡献者陷阱 |
| F2 | `useSkillTranslation` 三处 `gcTime: Infinity` 永久钉住翻译会话缓存 | 坐实（代码核对；浏览器 clamp 未实测，**影响降级**） | 原 P1 夸大：泄漏量级 = 会话内翻译文本，非崩溃级。修 = 一行改有限 gcTime（如 24h），A→B→A 体验不变 |
| F3 | `useRefreshRepoPanel` 双 fetch 均 `.catch(() => undefined)`，下拉刷新在网络失败时静默假成功 | 坐实（逐行核对） | 显式刷新动作失败无任何反馈；onError toast 一行 |
| F4 | `useSaveSkillContent` 对可空 `skillId` 用 `!` 断言直接送 IPC | 坐实（逐行核对） | 当前调用方恰好安全，但 hook 契约本身允许坏调用；一行 guard |
| F5 | `useUpdatePluginsDiscoveryEnabled` 二次请求失败时不 invalidate `["skills","installed"]`（后端设置已改） | 坐实（逐行核对） | onError 补一个 invalidate，一行 |

### 顺手修批（一行级卫生，后悔不对称成立）

| # | 发现 | 属实程度 | 备注 |
|---|------|---------|------|
| R15 | `get_github_token` 把原始 token 送渲染层，但**前端无任何消费者**（唯一引用是 api 层定义） | 坐实 + grep 实证 | 删除或停用该 command；CSP `script-src 'self'` 下 XSS 风险本就低，这是清掉无谓的爆炸半径 |
| R9 | `copy_dir_contents_at_depth` 跟随绝对 symlink 拷贝（当前被 zip 9 解压策略缓解，属潜伏） | 坐实（逐行核对） | 显式拒绝绝对 target，2 行 |
| R10 | `fetch_repo_tree` 不建模 GitHub `truncated` 标志 | 坐实（grep 无此字段） | 大仓库假"路径不存在"+ digest 不稳定；一行 |
| R13 | `atomic_write` 无目录 fsync | 坐实 | rename 后 `File::open(dir)+sync_all`；对 settings/metadata 的持久性声明负责 |
| R14 | 3 处命令错误形状双轨（`search_skills_sh`/`get_skill_audit`/`get_skill_catalog` 返回裸 String） | 坐实；2026-11-18 triage 同项未清 | 统一走 `CommandError`，前端 retry UX 才能识别 |
| R19 | `config.rs` 在懒初始化里 `std::env::set_var`（多线程进程非线程安全，edition 2021 无 unsafe 警告） | 坐实 | 挪到 `main` 启动早期 |
| R20 | usage 收集器 `path.is_dir()` 跟随符号链接递归、无深度上限（`lock.rs` 的 `collect_regular_files` 有正确的 `is_symlink()` skip） | 坐实（逐行核对） | 用户目录里一个 symlink 环 = 栈溢出；镜像既有 skip 模式 |
| R23 | `SkillUsageCache` 用 `.lock().unwrap()`，全库其余处均 `unwrap_or_else(into_inner)` | 坐实（agent） | 与全库一致，顺手 |
| R4a | update-history 三命令（get/delete/clear）无 lease、无互斥，`atomic_write` 固定 `{file}.tmp` 名可被并发命令交错 | 坐实（逐行核对；竞态未实测） | delete/clear 补 lease；固定 tmp 名是更深问题，可并入 R4b |
| F6 | 窗口拖拽 `await win.toggleMaximize()/startDragging()` 无 catch，且无全局 unhandledrejection handler | 坐实（逐行核对） | `.catch(() => {})` 或 void 化 |
| F9 | `en.json` `browse.skills: "{{count}} skills"` → "1 skills"（全库其余处用 "(s)" 约定） | 坐实 | 改 "{{count}} skill(s)" 对齐 |
| F10 | token 对话框 `dialogStatus` 不查 `verificationQuery.isError`，网络失败静默落回"已配置" | 坐实（逐行核对） | 一行分支 |
| F11 | `useConsistencyLabelSettings.write` 裸 `localStorage.setItem`（全库其余 accessor 均有 guard） | 坐实（逐行核对） | 对齐 |
| C4 | CLI journal 恢复对空数组 journal 删除（桌面 fail-closed 保留） | **实证 + 勘误**（原 P2 降级） | 原报告"内容型数组被删导致半写状态丢失"不可达——文件名白名单先拦。对齐 fail-closed 一行 |
| C5 | `runCli` JSON 错误 envelope 死代码（commander 无 `exitOverride`，未知命令直接 `process.exit`） | 坐实（agent 实证） | `--json` 消费者拿空 stdout；加 exitOverride |
| C7 | `imports scan` 的 `alreadyImported` 用 `path.resolve`，add 路径用 `realpathOrOriginal` | 坐实（agent） | 对齐 |
| C9 | lock 空 `sourceUrl` 语义分歧（CLI `??` vs 桌面 `!url.is_empty()`） | 坐实（agent） | 对齐桌面语义 |
| CI1 | `build.yml` 8 个 job 仅 2 个有显式 `permissions:`，其余（含跑 `bun install` 的测试 job）继承仓库默认 | 坐实（grep 验证） | 顶层 `contents: read` + 逐 job 提升，卫生级 |
| CI2 | 第三方 action 用可变 tag（setup-bun/rust-cache/install-action），其中两个跑在涉密 job；dtolnay/peter-evans 已 SHA-pin | 坐实 | SHA-pin 三个 tag，低成本 |
| D4a | ADR 行号引用漂移（ADR 8：2114→实际 1951；ADR 10 引用的 `report_missing_baseline` 已不存在） | 坐实（grep 实证） | 刷新为符号引用（ADR README 明言路径/符号是"回到代码的接口"） |
| D4b | RELEASE_BODY 把 Homebrew/Portable 段注释掉、README 零提及，而 CI 每次 tag 都发布 cask、site 安装弹窗主推 brew | 坐实（三处核对） | 取消注释或明确不开渠道——三张嘴一个答案 |
| D3 | `docs/development.md:45` Node 版本表述（build.yml 实际全程用 Bun，仅 site.yml 用 Node 24） | 坐实（agent） | 一句改写 |

### 排队（真实但需要设计或成批做）

| # | 发现 | 属实程度 | 备注 |
|---|------|---------|------|
| R5 | 损坏 `metadata.json`：启动静默重置（丢星标/"我的"），但租约路径 `MetadataStore::load()?` 使**所有**写命令永久失败——双读路径失败语义互相矛盾，应用卡在"能读不能写" | 坐实（链条逐行核对） | 需定统一失败语义（推荐：损坏 quarantine + 明确错误 + 文档化）；与温床 3 合并处理 |
| R6+R16 | 无 journal 的移动类操作各留 crash 窗口：archive manifest 孤儿（上轮已裁决排队）、`replace_skill_dir_with_rollback` 备份孤儿（技能消失且被 `is_app_temp_dir` 藏住，启动只清 `.zip.tmp`） | 坐实（R6 逐行核对） | 统一的启动孤儿扫描/`doctor fix` 对账层，一个批次解决两类 |
| R8 | watcher notify 回调 `if let Ok(event)` 丢弃全部错误；backend 静默掉 watch 后 UI 无限期陈旧 | 坐实（逐行核对） | 最低成本先 log + 计数；liveness 检查需设计 |
| R12 | lease 端口碰撞（2 字节哈希确定性端口）使**应用无法启动**（setup `?` 传播），错误文案误导 | 坐实（我核对 port 推导 + attempts=1 + setup 传播）；上轮 triage 曾判"不修" | **重开**：新证据是启动阻断语义；低成本部分 = release 重试 + 明确报错"端口 N 被无关进程占用"；回退端口机制是设计决策 |
| R11 | `remove_skill_dir` 在 SKILL.md 缺失时静默 `Ok`，技能目录残留但应用层面"消失" | 坐实（agent） | **待决策**：按定义已非 skill 应可删，还是显式报不匹配 |
| R21 | merge `.backup.` 残留无启动清理（上轮判"不修"），叠加 R3 后 watcher 过滤修复会消除幽灵 upsert 路径 | 坐实 | 并入 R6 的孤儿扫描批 |
| R24 | settings.json Windows 侧无 ACL 硬化（unix 已 0600） | 坐实（agent） | 待决策是否需要 |
| C2 | CLI 把 SSOT 内的 external import 当 installed skill 上报，桌面同状态为空（缺 `external_source_under_ssot` guard） | 坐实（agent 实证） | CLI 补同款 guard |
| C3 | `skill-zoo refresh`/`status --refresh` 无条件清掉 plugin 缓存条目（桌面只在开关关闭时清） | 坐实（agent 实证） | CLI rebuild 保留 plugin 条目或尊重开关 |
| C6 | CLI 读路径宽松（null→{}、非数字 version 直通），桌面同字节报错 | 坐实（agent） | 对齐严格性，小批 |
| C8 | fixtures 缺 malformed-JSON / SSOT-resident import / `pluginSource` 形态 | 坐实（agent） | 与 2026-11-18 的 fixture 扩充批次合并 |
| F7 | `RepoTasksProvider` value 未 memo + `handleOpenRepoTask` 未稳定引用，编辑器每键程全量重渲染消费者 | 坐实（我核对 return 无 useMemo + 裸函数） | useMemo/useCallback 一对；影响仅性能 |
| F8 | `ssotSkillDirs` 靠"`directory == skillName`（SSOT 时）"的未文档化约定（前端两处 + 后端 `skill.rs:1445,877`），测试 fixture 还用了绝对路径示范反例 | 坐实（agent 验证后端） | 温床 1：fixture 修正 + 一个钉住约定的测试 |
| D2 | site 组件四处硬编码中文渲染在英文页（Architecture/Experience/DesignDecisions）+ Nav 死键 `nav-download`（ui.ts 无此键） | 坐实（grep 验证） | 移入 ui.ts 双语化，机械但量不小 |
| D5 | ADR archived 记录 `date` 被重盖为归档日（README 只钉 `created` 不可改） | 坐实（agent） | 二选一：README 定义 `date` 语义 or 恢复原值 |

### 不修 / 记录

- **R22** `home_dir()` None 回退 CWD——2026-11-18 已判不修，无新证据。
- **F12** repo-task progress map 会话级无界——有界于会话，纯推导状态，不值得动。
- **F13** 保存 pending 时丢点击、**F14** AppUpdater dead generation check 死代码——UX 打磨/清理项，记录。
- **F15** markdown fragment `split("#", 2)` 截断多 `#`——真实边缘，静默降级可接受。
- **F16** `useRepoPanelRefresh` wheel listener 每渲染重订阅——性能噪音非正确性（注：agent 引用扩展名勘误 `.tsx`→实际 `.ts`）。
- **D6** docs/superpowers 旧 plan/spec——gitignored 本地文件，不入库，本地可删。
- **CI3** CSP `img-src http:` 收紧候选——沿用上轮裁决：确认无 http 图源后一行收紧。
- **CI4** vitest jsdom 每文件创建 57 次（40s）——perf 提示非缺陷，换 `vmThreads` 可选。

## 勘误记录（对 review 原报告的修正）

1. **C4 降级**：CLI agent 声称"数组形态 journal 被删、settings.json 半写状态丢失"。实证：`Object.entries(["agents.json"])` 产生键 `"0"`，先撞文件名白名单（`agent-transaction.ts:31`）抛 CliError，journal 保留——只有 before/after **均为空数组**才走到 `rm`，而那种情况无可恢复内容。声称的数据丢失路径不可达，P2 → P3。
2. **F2 降级**：`gcTime: Infinity` 机制坐实（三处调用点），但"内存泄漏"量级是会话内翻译文本，浏览器把 `setTimeout(…, Infinity)` clamp 到 ~24.8 天（文档化行为，未实测）。P1 → P2，修复仍值得（一行）。
3. **F16 勘误**：引用文件 `useRepoPanelRefresh.tsx` 实为 `.ts`。
4. **skill_folder_drifted 双报合并**：持久层 agent 报 P3、services agent 报 P1。取中：fail-open 机制坐实（`Err(_) => false`），触发面边缘（权限错误/深度>20），后果是更新静默覆盖本地修改——**值得修（fail-closed）**，定 P2，列入立即修批（R2）。
5. **R12 重开**：上轮 triage 把"租约端口 2 字节哈希"归入不修批（"低概率/有自愈"）。本轮新证据：`AgentLease::acquire` 失败经 `lib.rs:50-52` setup `?` 直接阻断应用启动，且错误文案指向"另一个更新操作进行中"。自愈依赖无关进程退出，不成立时不可诊断。重开为排队（低成本错误信息部分先行）。
6. **R15 增强**：持久层 agent 称 token 送渲染层"扩大 XSS 爆炸半径"；grep 实证前端无消费者——修复成本从"改造"降为"删除"。

## 温床（结构性，ADR 候选，不随本次修复动）

1. **SSOT `directory == skillName` 隐式约定**——前后端各一处消费，无类型/测试钉住；后端若改返回嵌套相对路径，前端更新候选集静默变空。→ 测试钉住即可，不必抽象。
2. **临时目录过滤谓词两份实现**（`path_has_ignored_component` vs `is_app_temp_dir`）——R3 就是它产出的 bug。→ 收敛为单一谓词。
3. **双读路径失败语义**（启动 `unwrap_or_else` 静默 vs 租约 `load()?` 严格）——R5 是它产出的 bug，且语义该是什么是产品决策。→ 定一个语义写进 local-protocol 文档。
4. **无 journal 的移动类操作**（archive/restore/replace/update）各自留 crash 窗口，启动清理只覆盖 `.zip.tmp`。→ 统一孤儿扫描/对账层（R6+R16+R21 批次）。
5. **错误形状双轨**（String vs CommandError）——上轮已录，仍在产出 R14。
6. **ADR 行号引用**天然漂移——改用符号引用约定（D4a 顺手后写进 adr/README 一句话）。

## 落地建议

一个"立即修"批次（表中 11 条，全部一行级或小函数级，含两个 P1：R1、C1）+ 一个"顺手修"批次（约 20 条卫生项）可以合并为 1-2 个 PR 完成；排队项中 R5（metadata 失败语义）与孤儿扫描层（R6+R16+R21）建议走 `adrkit-propose` 定取舍后再动，它们是产品决策不是 bug 修补。

## 方案对抗重估（2026-11-19，"立即修"11 条）

对每条先假设原方案错误，从最强反对者角度找反例，再重估。4 条被修正，7 条维持（含 2 条微调）。

### 被修正的方案

**R1 分支截断——原方案"join 全部段"被反例推翻一半。**
反例 1：`tree/main/skills/foo`（指向仓库子目录的 URL）在 join 全部后 branch 变成非法的 `main/skills/foo`，而现行截断行为碰巧正确——两类输入都真实存在（从 GitHub 页面复制链接，分支链接与目录链接同样常见）。反例 2：URL 天然歧义，branch 与仓库内路径在解析时不可区分（GitHub 靠 ref 匹配消歧）。反例 3：影响面比原判大——`parse_repo_query` 有三条生产路径（discover `cli.rs:74`、update 流 `cli.rs:674`、`commands/skill.rs:2030`），不止 Discover 页。反例 4：`archive_zip_url`（cli.rs:655）对 branch 做 `urlencoding::encode`，斜杠分支编码为 `feature%2Fx`，archive 端点对 %2F 的接受度未验证，方案必须连带处理 URL 构造。
**修正方案**：解析时 join 全部段作为"分支候选"；下载层对 archive URL 做**渐进前缀回退**（最长→最短，404 逐级缩短——archive 端点非 REST API，404 重试不耗 API 配额）；解析出的真实 branch 写回 lock（`update_repo_info` 已优先取 `entry.branch`，管线现成）；URL 构造改用字面斜杠。旧 lock 中已截断的 branch 无法自愈（sourceUrl 归一化时丢了 tree 路径），重装一次即修复，记入文档。成本从"一行"涨到 ~40 行 + 测试，但这是唯一不破坏任一类输入的解。

**R3 watcher 过滤——过滤点从事件层移到唯一写入咽喉点。**
反对意见 1（事件层过滤会吞 rename 事件）被核实排除：`watcher.rs:195` `for path in &event.paths` 遍历全部路径，rename 目的地独立成 root，过滤 staging 名不影响 rename-to-final。反对意见 2 更有价值：`scan_skill_roots_batch` 是增量 upsert 的唯一咽喉点，且被两条路径共用（watcher.rs:347 与 agents.rs:641 注册表变更），在该处过滤 = 一处修覆盖两路，并与全量扫描的 `is_app_temp_dir` 收敛为同一谓词（直接消解温床 2）。
**修正方案**：过滤点改为 `scan_skill_roots_batch`（提取 file_name 走 `is_app_temp_dir`）。另发现 staging 目录在集成测试中零覆盖，回归测试需从零写（红→绿）。

**D1 AGENTS.md 句子——"留作参考"的改法差点掩盖分支剩余内容。**
反对者指出 `git log main..next/own-protocol` 有 **2 个**非祖先提交，不止重新落地的那一个。深挖：`git cherry main next/own-protocol` 两个提交均 `-`（补丁等价存在于 main：`89b22f3`、`4b19d8e`，后者 `--is-ancestor` 确认在 main 上）。内容层面分支完全冗余，但注意：`git branch -d` 检查的是祖先关系而非 patch-id，会拒绝删除——文档句子必须写明这一点，否则读者试 `-d` 失败会更困惑。
**修正方案**：句子改写为"两个提交均已等价落地 main（89b22f3、4b19d8e；`git cherry` 可验证），因祖先关系断裂 `-d` 会拒绝，删除需 `-D`"。

**F4 skillId!——运行时 guard 违反 AGENTS.md 自己的规矩。**
反对者援引"不为不可能发生的场景写错误处理"。核实：`useSaveSkillContent` 全库唯一消费者是 `useEditorState.ts:23`，其 skillId 是 `useState<string>("")`，永不为 null；`""` 提交时编辑器必然未打开（unreachable）。
**修正方案**：把 mutation 参数类型收窄为 `skillId: string`（零运行时代码，编译器接管契约）；同时从 mutation 契约中移除 mutationFn 未消费的 `directory`（同步改 `useEditorState.ts:73` 调用点）。

**F3 刷新静默失败——"加 onError toast"在当前结构下不会触发。**
新事实：`main.tsx:20` 已有全局 `mutations.onError → toast`。`useRefreshRepoPanel` 静默的真正原因不是缺 onError，而是 mutationFn 里两个 `.catch(() => undefined)` 把错误在 mutation 层**之前**吞掉——全局 toast 根本看不到失败。而"删掉 catch 让 rejection 传播"会破坏部分成功语义：metadata 成功 + readme 失败时，rejection 使 onSuccess 不运行，成功的部分也丢掉（catch 是承重的）。
**修正方案**：mutationFn 返回 `{ metadata, readme, error? }`（错误进结果不进 rejection），onSuccess 应用成功部分并在有错时显式 toast——单次受控 toast，不破坏部分成功，也不与全局 onError 双 toast。另注意：不能改用 `invalidateQueries` 兜底——那会把"强制刷新（force=true 绕过 TTL）"降级成"读 24h TTL 缓存"，语义倒退。

### 维持原方案的（含核实细节）

- **C1**：核实桌面 re-import 是**原地**更新 known 三字段（source_path/directory/updated_at）并保留 extra（`commands/skill.rs:550-559`），CLI 应完全镜像此语义而非整对象替换（结果一致、语义对齐）。附带发现（P3）：CLI re-import 即使无实际变化也报 `added`。spread 的理论反例（未来"语义上该重置"的字段被保留陈旧值）不成立——协议文档明文要求保留未知字段，重置是新版本的责任。
- **R7**：grep 证实全部其余 mutation（install/update/toggle/archive/merge/agents）均持 `cache_refresh_lock`，1420-1490 是唯一缺口；lease→lock 顺序全库一致无环（watcher 只拿 lock 不拿 lease）；锁住 trash 的时长是 rename 级毫秒。原方案维持。
- **R17**：反对者指出 archive 元数据无法重建"归档前 home agent 是否有过平铺链接"的史实（apps 只记 enabled）——两种历史确实不可区分。回应：平铺链接指向嵌套 home 本身是重复可见性的病态布局，保守跳过即恢复常见实际状态；真有此布局者可 UI 重 toggle。skip 条件须精确为 `home_agent == Some(agent) && restore_path != agent_dir.join(leaf)`（非嵌套已由 is_native_home 分支处理）。维持 + roundtrip 测试断言平铺链接不存在。
- **F1**：反对者以相邻 `data-screenshot-only` 元素质疑"英文是营销截图有意为之"——不成立：ADR 5 只允许一个有意英文例外，且 `usageCalls` key 存在未用说明是遗忘非决策；screenshot-only 本就是隐藏元素。维持；实现时顺带确认日期区间格式走 date.ts。
- **F2**：核实全局 QueryClient 无 gcTime 覆盖（默认 5 分钟），Infinity 是 A→B→A 活性的承重设计。反对者的代价真实：改 24h 后"离开文件 >24h 回来需重新翻译（花 token）"。权衡后维持 24h（无界内存 vs 有限重译成本；LRU 方案代码量更大且破坏既有 A→B→A 测试）。`setOptions` 修改 gcTime 的生效机制（最后 observer 移除时读取当前值）未实测，标注。
- **F5**：双失败极端情形（invalidate 的 refetch 也失败）由 query 层既有错误面兜底；updateSetting 失败时的无害 refetch 可接受。维持。

## 落地记录（2026-11-19 第一批：最本质根因）

**第一性原理定位**：AGENTS.md 地基是"文件系统是事实来源，缓存从 FS 重建"，由此推出承重不变量——**一个缓存条目只能来自一个全量扫描也会接受的目录**。本轮 R3（幽灵 skill）、merge 残留幻影（R21 watcher 半边）的共同本质违规是"什么目录可扫描"这条规则存在两份实现（全量的 `is_app_temp_dir` vs 增量的 `path_has_ignored_component`），增量缺临时目录规则。让不变量结构化成立 = 单一谓词收敛到唯一咽喉点。

**咽喉点核实**：`scan_skill_roots_batch` 是增量 upsert 的唯一入口（生产调用者仅 watcher.rs:347，agents.rs:641 是测试）；entries 按条目 id 经 `upsert_cache_entries` 插入而非位置映射，batch 内过滤 root（不产条目）安全；事件派生路径是唯一能凭空铸造新缓存条目的路径（其余 `scan_skill_root*` 调用者都拿缓存/lock 里已有目录）。

**已实施**（红→绿）：
- 红测试 `scan_skill_roots_batch_skips_app_staging_directories`（`skill_service_test.rs`）：`.demo.install.123` 含 SKILL.md → batch 产出条目（实证 bug 存在）；`.demo.backup.9` 同断言；rename 为 `demo` 后正常扫描（对照，防过滤过宽）。
- 修复：`scan_skill_roots_batch` 循环内按 `skill_root.file_name()` 走 `is_app_temp_dir` 过滤（单一谓词复用，零新规则）。
- 全量后端套件 409 通过 0 失败（408 + 新测试）。

**验证边界**：watcher ≥1.5s 事件静默窗口的真实时序未实测（不稳定），测试直接钉住咽喉点不变量——无论时序如何，staging 目录进不了缓存。`.update.` 标记与 `is_app_temp_dir` 既有单测共用覆盖。事件层的 `path_has_ignored_component` 保持原样（对手重估结论：过滤点在咽喉点已闭环，事件层仅多一次无害的 0 条目广播）。
