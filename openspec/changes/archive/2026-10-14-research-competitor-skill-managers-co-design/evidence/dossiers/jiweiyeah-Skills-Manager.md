# jiweiyeah/Skills-Manager(★1023|Rust workspace + React 19/Tauri 2|2026-09-10 push|MIT)

## 1. 定位与架构(实证)
一句话:hub-and-spoke 技能同步器。写一次,以 symlink(+Windows junction/受管拷贝兜底)分发到 32 个内置 agent,GUI 可选。

- 技术栈:Rust workspace(`crates/core` 15k 行 + `crates/cli` 的 `skm`)+ React 19/Tauri 2(README Tech Stack;顶层 Cargo.toml)。README 语言标 TypeScript 是 GitHub 识别偏差,核心在 Rust。
- SSOT 模型:用户首启自选 hub 目录(config.skills_dir),实体文件在 hub;agent 目录 symlink。CLI 与 GUI 读同一 config、同一批链接(crates/cli/src/context.rs:55 lock_config;README "reads and writes the same config and symlinks")。方向与 skill-zoo 一致,差别:hub 位置用户可选(skill-zoo 固定 `~/.agents/skills/`),无"本地技能绝不移动"约束。它的 `skm adopt` 会把 agent 目录里的实体目录**移入** hub 再回链(crates/cli/src/commands/adopt.rs:34-64)。
- 链接策略三连(Windows 零管理员):目录 symlink(开发者模式/提权)→ junction(`cmd /C mklink /J`,linker.rs:239-295)→ 受管拷贝,源路径写入目标内 `.skills-manager-source.json` 供追踪与可停用(linker.rs:30,42-76)。启用前安全检查:只替换 symlink/junction 或受管拷贝目录,不碰真实目录(linker.rs:190-192,305-308)。
- 数据模型:单一 config 文件(AppConfig,config_manager.rs 1416 行)+ 扫描即得;技能实例化 `Skill{id, instance_id, scope: Global|Project}`(models/skill.rs:10-72),32 个 agent 是 `SUPPORTED_TOOLS` 静态表(models/tool.rs:55 起,`config_dir`+`alt_config_dirs`+`cli_command`+可选 `project_skills_dir()` 白名单 tool.rs:34-47)。
- 形态:桌面 GUI + `skm` CLI(同 core crate);无服务端。

## 2. 功能清单
- 32 agent 内置约定表 + 自定义工具 [完整] models/tool.rs:55-430。
- 三级链接策略(尤其 Windows) [完整] services/linker.rs:143-295,含测试 `iflow_enable_skill_uses_copy_mode_instead_of_symlink`。
- `skm` CLI:init/adopt/enable/disable/list/doctor/fix,均支持 `--json` 与前缀匹配(claude→claude-code) [完整] crates/cli/src/commands/。
- doctor 体检 [完整] commands/doctor.rs:工具检测表 + 链接状态逐条 issue(expected vs status)+ **companion skill 新鲜度检查**,用于发现升级后 hub 里的技能说明落后于当前 skm 的情况,报告而非静默刷新(doctor.rs:74-80 注释)。
- 技能 zip 导出/导入:manifest + 导入前冲突预览 + skip/rename 策略 [完整] services/skill_transfer.rs:273-400。
- 市场:GitHub API + ClawHub API 双源聚合(marketplace.rs:21-26) [完整]。
- 风险扫描:35 条静态规则(破坏性/网络/提权/可疑载荷)+ 上下文降权(代码示例 0.3x、注释 0.5x、`rm -rf node_modules` 白名单)+ 可选 LLM 复审 + 按 instance_id+path+mtime+scanner_version 的缓存(risk/rules.rs:1-50,risk/cache.rs:1-4) [完整,自述参考 NVIDIA SkillSpector 两阶段架构]。
- AI 翻译技能名/描述/内容 [完整] services/translation.rs(+缓存)。
- companion skill(`skills-manager-cli`)安装时写入 hub 并对所有检测到的 agent 启用;release 流水线 `npm run publish:skill` 发布到 ClawHub,本地版本不严格更新则跳过(README CLI 节) [完整]。
- 命令面板、双语 UI、Raycast 风格(DESIGN.md 纯样式规范) [完整]。

## 3. 借鉴候选(90 分门槛)
1. **安装期技能风险扫描(静态规则引擎 + 上下文降权)**
   - 是什么:安装/导入前对 SKILL.md 及脚本做静态安全分析:35 条 regex 规则分 4 类,按代码块语言与上下文位置降权(示例代码 vs 可执行指令),`SAFE_RM_TARGETS` 白名单压误报,结果带 rule_id/confidence/行号;LLM 复审是可选第二阶段。
   - 程度:risk/ 模块 parser(30 行结构清晰,逐块带行号/语言/上下文标记)+ rules(881 行,每条规则可带 filter 精调)+ 缓存(键含 scanner_version,升级即失效)+ 22+ 单测。设计感明显高于"扫几个关键词"的做法。
   - 为何 great:技能本质是会被 agent 执行的指令文本,安装前风险提示是真实痛点(prompt 注入/数据外传);两阶段降权 + 白名单说明作者认真对待误报。这正是它与"摆设扫描器"的分界线。
   - 落点:skill-zoo 的发现/安装 preflight(Rust 侧)。可先吸收静态阶段(parser+rules+缓存),LLM 阶段不做;与 Tauri IPC 边界无冲突(纯本地计算),代价中(1-2k 行移植/重写)。
2. **doctor/fix 二段式 CLI 自检**
   - 是什么:`doctor` 只做诊断,产物是工具检测表 + 每条链接 expected vs actual 的 issue 列表(JSON 输出),`fix --yes` 才修复;另诊断 companion skill 过期问题并只报告不静默改(adopt.rs/doctor.rs/fix.rs)。
   - 程度:issue 结构化(skill/tool/expected/status),与 GUI 同步状态共用同一 resolve_sync_status,GUI 与 CLI 不出两套真相。
   - 为何 great:对"文件系统是真相"的架构,漂移是常态;把"诊断"与"修复"分成两个显式步骤 + `--yes` 门,是对 agent 调用方最安全的接口设计。
   - 落点:skill-zoo CLI(packages/cli 或 Rust CLI)加 `doctor`;复用桌面已有的 cache 重建/扫描逻辑。代价小;完全兼容。
3. **Windows 零管理员链接链(symlink→junction→受管拷贝+源路径标记)**
   - 是什么:见 §1。受管拷贝目录内写 `.skills-manager-source.json` 记录源路径,使拷贝可追踪、可停用、可校验是否与源一致(linker.rs:63 copy_mode_target_matches_source)。
   - 程度:三级 fallback 完整实现并测试;junction 检测单独处理(Windows junction 不被 is_symlink 报告,linker.rs:99-101 注释)。
   - 为何 great:skill-zoo 是 Tauri 三平台应用,"Windows 普通账户下 SSOT 怎么办"是必答题。junction 保持单一真相(是目录链接非副本),应作为首选 fallback;受管拷贝+标记是最后一级的诚实做法。
   - 落点:src-tauri 链接创建/扫描模块。注意:skill-zoo 扫描需识别 junction(`fs::symlink_metadata` 不够),否则 Windows 下 junction 部署会被误判。与 SSOT 决策兼容(junction 仍指向 SSOT)。
4. **companion skill 版本门控发布到市场**
   - 是什么:CLI 配套技能随 release 自动发布 ClawHub,仅当本地版本严格更新时上传,重跑幂等;doctor 端配套检查 hub 内副本是否过期(README;doctor.rs:74-80)。
   - 程度:完整 CI 化 + 幂等门控 + 消费端新鲜度检查,两端闭环。
   - 为何 great:解决"应用升级后,agent 手里的说明书还是旧的"这一被普遍忽略的漂移点。
   - 落点:skill-zoo 若发布官方 drive-skill(见 xingkongliang 档案),此为发布流水线与 doctor 检查的补充;代价小。

## 4. 明确不借鉴(带理由)
- `skm adopt` 把用户 agent 目录里的实体技能移入 hub:与 skill-zoo"本地技能绝不复制/移动、软链指回原目录"的决策正面冲突;skill-zoo 的 local-origin 方案更保守且已实现。
- hub 目录用户可选:skill-zoo 固定 `~/.agents/skills/` 是协议决定,不做迁移就不应引入可变 SSOT。
- AI 翻译技能内容:翻译译文可能偏离作者原意且制造第二真相,伪需求。
- 4380 行单文件 marketplace.rs(GitHub+ClawHub 聚合):结构上是"一个大文件塞下所有 API";聚合思路本身 skill-zoo 的 discover 已覆盖,代码组织不值得学。
- 命令面板/Raycast 视觉:纯 UI 品味,与协议无关。

## 5. 借鉴裁定
ABSORB: 安装期静态风险扫描(risk/ 的 parser+rules+缓存,LLM 阶段不要);doctor/fix 二段式自检 CLI;Windows 零管理员链接链(junction 优先,受管拷贝+源标记为底线,扫描侧需识别 junction);companion skill 版本门控发布(配合 drive-skill 采用)。
