# luongnv89/asm(★955|TypeScript|2026-10-14|MIT)

## 1. 定位与架构(实证)

一句话定位:面向 AI agent 与自动化的技能包管理 CLI/TUI。其第一性设计是「每个命令都可脚本化」(`--json`/`--yes`/`--machine`),安装/审计/检索是第二位。

技术栈:Node 22+ / TypeScript / esbuild,TUI 用 Ink(React 渲染到终端),Vitest 测试(约与源码 1:1 的 .test.ts)。

SSOT/分发模型:**默认复制,SSOT 是 opt-in**。`executeInstall` 直接 `cp -r` 到 provider 目录(src/installer-core.ts:729);装到全部 provider 时以 `agents` provider 为 canonical、其余 provider 建相对 symlink(src/installer-core.ts:771-814)。真正的中心库是显式的 `asm install --library`:实体存 `~/.config/agent-skill-manager/library/skills/` + `library-lock.json`(记 commitHash,src/config.ts:216-226),`asm activate` 才建链接。冲突时新装覆盖需 `--force`(installer-core.ts:715-722)。与 skill-zoo 的「SSOT 强制 + agent 目录永only symlink」相反:asm 的日常路径制造副本,靠 audit 找重复。

形态:npm 全局 CLI + 可选 TUI;技能来源为 GitHub repo(`github:o/r#ref:path` 语法,installer-core.ts:120-215)、自建 PR 式 registry(pinned commit)、内置离线 catalog(data/skill-index)。

## 2. 功能清单

- [完整] GitHub 安装:浅克隆→frontmatter 校验→复制;SHA 走 no-checkout+checkout(installer-core.ts:416-427);`auto` 传输 HTTPS 失败回退 SSH(installer-core.ts:461-487)
- [完整] 多 provider 安装:canonical+symlink(installer-core.ts:771-814);已有非链接目录跳过不覆盖(:791-800)
- [完整] library/activate/deactivate + library-update(原子写+文件锁,library-core.ts:16-19)
- [完整] `asm link` 开发期 symlink;`asm init` 脚手架
- [完整] `audit` 重复检测;`audit overlap` 语义重名(本地启发式)
- [完整] `audit security`:28 条正则规则×严重度×permissionType(security-auditor-scan.ts:22-265)+ GitHub 来源分析(:269-325)+ 权限归纳(:385-454);publish 时 warning 级需 `--force`,安装本身只报告不拦截
- [完整] **attention budget**:`stats --tokens` 区分 resident(description,每条消息都付)与 body(触发才付)(stats-tokens.ts);`audit residency` 给 demote 阶梯建议,数据不足的信号显式标 unavailable 而非静默丢弃(residency.ts:361-365)
- [完整] `get` 参考层:stdout 输出 body 不安装,4 级解析梯 installed→library→index→registry,歧义时报错列出候选(commands/get.ts:49-54);`--path` 借出目录带所有权证明的 cleanup
- [完整] `--machine` v1 信封(utils/machine.ts:21-52)
- [完整] export/import manifest v1(exporter.ts:21-26;importer.ts 严格校验+`--diff` 冲突视图)
- [完整] index ingest/search:克隆→发现(深 5 层)→verify→打分(词匹配 10/5/3/1,skill-index.ts:47-50)→只存元数据;随包发布离线 catalog(config.ts:237-245)
- [完整] update/outdated:library-lock 记 commitHash,与 registry manifest 比对(updater-core.ts:330)
- [半成品] `eval` 质量评分:rubric 是启发式规则,非真实评估
- [半成品] `deps` 租约:caller-owned 临时依赖会话,恢复靠人工选 cutoff,README 自己承认「不监督进程」
- [摆设] `audit overlap` 跨技能语义重叠:词面相似度,实测价值存疑

## 3. 借鉴候选(90 分门槛)

### 3.1 `--machine` 版本化 JSON 信封

- 是什么:`{version:1, command, status:"ok"|"error", data|error{code,message,details}, meta{timestamp,asm_version,duration_ms}}`,错误码枚举(utils/machine.ts:21-52);human chatter 强制重定向 stderr 保证 stdout 纯净(:54-70);非 TTY 输出 compact JSON。
- 程度:v1 冻结 key 注释明确「不得改名或双 key」;7 个稳定错误码;每个支持命令都有实现与测试。同类 npx skills 只有零散 `--json`,无信封无错误码。
- 为何 great:这是协议设计而非输出美化。版本字段让未来 v2 可共存,错误码让 agent 可编程分支,stdout 纪律让管道可靠。
- 落点:packages/cli 的 Rust 输出层加 `--machine` flag + 信封 struct。additive,不触碰 npx skills 兼容语义(新 flag 不改变既有命令行为);协议属桌面自有 CLI 层,符合「桌面拥有本地协议」。代价:中(每命令包一层,但可做成统一 writer)。

### 3.2 安装前安全审计的规则分类学与「报告不拦截」哲学

- 是什么:规则按类别(网络/shell 执行/动态代码/文件系统/凭证/环境变量/混淆)×严重度(critical/warning/info)×permissionType(filesystem/shell/network/code-execution/environment)三维组织(security-auditor-scan.ts:22-265);另做 GitHub 来源画像(账号年龄/是否 org/公开仓库数)。
- 程度:4 个竞品中唯一有 install 前扫描的;有测试、有独立报告模块;publish 通道用同一扫描做强制门槛(warning 需 `--force`),安装通道只报告,是一组合理的双门槛设计。
- 为何 great:不是规则多,而是把「技能是文本,正则必然误报」这个事实转化为报告型权限模型(告诉用户「这技能会碰什么」),而非伪杀毒。正则扫 markdown 有固有误报(curl 写在教程里也命中),但作为权限声明而非拦截器是自洽的。
- 落点:src-tauri 安装 preflight(与现有 install conflict check 同层)加 Rust 版规则表 + Tauri 命令返回结构化 findings;UI 在安装确认对话框展示。规则清单可直接移植(category/severity/permission 三元组)。代价:中;无架构冲突(纯只读分析,文件系统为真相)。

### 3.3 Attention budget / residency 审计

- 是什么:核心洞察是「disk is cheap, context is not」。已装技能的 description 常驻每条消息,body 只在触发时付;分别估算并按 tool/scope 聚合,residency 报告按 demotion 阶梯(installed→library→disabled→reference)给可执行命令。
- 程度:token 估算是字符启发式(stats-tokens.ts:26),但聚合维度(per-tool/per-scope/最重排行/中位数)完整;诚实标注不可用信号(residency.ts:361-365);零网络、纯本地。
- 为何 great:这是同类工具中唯一回答「装这么多技能我的 context 账单是多少」的;洞察正确且可证(description 确实进系统提示词)。
- 落点:src-tauri 新 stats 命令(Rust 估算+聚合)+ Local 页/技能详情展示 resident 成本;skill-zoo 的 symlink 模型让 demote 比 asm 更干净。asm 的 disable 要 rename SKILL.md(因 copy 模型所迫),skill-zoo 删 symlink 即可,移植后体验应优于原版。代价:中;无冲突。

## 4. 明确不借鉴(带理由)

- 默认复制分发:与 SSOT+symlink 核心决策直接冲突,是 asm 历史包袱(skill-zoo 的 origin 二分已解决同一问题)。
- library-lock/activate 双轨制:skill-zoo 的 SSOT 就是唯一的 library,无需第二套中心库+锁文件。
- `deps` 租约系统:为 agent 运行时按需取依赖设计,恢复策略靠用户猜 cutoff、清理靠调用方 finally,这样的设计复杂度远超收益,是伪需求。
- `eval` rubric 评分:启发式规则冒充质量评估,分数不可解释。
- PR 式 publish registry:skill-zoo 无自有 registry,marketplace 生态不同。
- disable=rename SKILL.md:copy 模型的 hack;skill-zoo 删 symlink 即达同理,方案本身不可移植。
- `asm get` stdout 解析梯:桌面 preview 已覆盖「先读后装」;CLI 侧偏离 npx skills 语义。
- config 锚点插入迁移(config.ts:264-324):工程质量好,但 skill-zoo 的 agent 可见性由 Settings 桌面管理,问题域不同。

## 5. 借鉴裁定

ABSORB: ①`--machine` v1 信封+stdout 纪律(packages/cli 协议层);②安全审计规则分类学+报告不拦截(preflight);③attention budget/residency(stats+UI)
