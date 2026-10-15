# Skill Zoo 对 gh skill 的独立评审

核查日期：2026-10-15。结论：说法属实，但应补上“自 v2.90.0 发布、功能仍为 public preview”。不需要追做命令或发布能力；需要纠正研究记录，并为已复现的共享锁文件互操作风险立一个有界 change。

研究基线：本仓 HEAD `76acd2106bdf577d9f041b36f7543467d7a5463c`，包含用户原有未提交变更；上游发布版 v2.102.0，tag 指向 `fc4b137cdef0a6bd28fd461b7cf9c84a5812a8cd`。上游 main 查询得到 `819f972eff771d5ec433c8d03c369cc43f1eab49`，本报告行为分析固定到发布 tag，不拿 main 冒充发布版。

方法标记：**实测**=执行正式二进制或生产函数；**源码确认**=实读源码控制流，未声称完成端到端执行；**推断**=由已确认前提推导影响；**价值判断**=优先级、范围与成本意见。

## A. 事实清单

### A1. 发布与命令身份

1. **官方原生命令，开源；并非 gh extension。** 实读 cli/cli 的 `pkg/cmd/root/root.go:153` 直接注册 `skillsCmd.NewCmdSkills`；`pkg/cmd/skills/skills.go:20` 定义命令、`GroupID: core`，源码受 MIT License 许可。下载正式 macOS arm64 二进制执行 `gh --version` 和 `gh skill --help` 成功。
   - [根命令源码](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/root/root.go#L153)、[skill 命令源码](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/skills/skills.go)、[MIT License](https://github.com/cli/cli/blob/v2.102.0/LICENSE)。验证：源码确认 + 二进制实测。
2. **首发 v2.90.0，2026-04-16；仍为 public preview。** GitHub API 返回该 release 的 `prerelease=false,draft=false,published_at=2026-04-16T18:19:28Z`；当前 latest 为 v2.102.0，2026-09-30，同样非 prerelease。这里“release 非 prerelease”与“skill 功能尚为 preview”是两个维度。旧机器 `gh 2.89.0` 实测报 unknown command，不能用旧版本否定现有命令。
   - [首发 release](https://github.com/cli/cli/releases/tag/v2.90.0)、[官方公告](https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli/)、[当前 release](https://github.com/cli/cli/releases/tag/v2.102.0)、[当前手册](https://cli.github.com/manual/gh_skill)。验证：gh api + 二进制实测 + 官方文档互证。
3. 当前六个子命令：`install/list/preview/publish/search/update`；组别名 `skills`，install 别名 `add`。`list` 是 v2.94.0 才加入，不能把当前全套命令倒推为 v2.90.0 首发全套。
   - [命令注册](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/skills/skills.go)、[v2.94.0 发布记录](https://github.com/cli/cli/releases/tag/v2.94.0)。验证：help 实测 + 源码与 release 实读。

### A2. 安装位置与内容写入

4. `gh skill install OWNER/REPO [skill[@version]]` 支持名字、namespace、精确路径；非交互默认 `--scope project --agent github-copilot`。project 相对 git root；解析 git root 失败时回退 cwd。`--dir` 覆盖目标选择。未指定版本优先 latest release，只有没有可用 release 才回退默认分支；API 故障不是无条件回退理由。显式版本可解析 tag、branch、commit，pin 后 update 跳过，`--unpin` 解锁。
   - [install.go:89](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/skills/install/install.go#L89)、[ResolveRef](https://github.com/cli/cli/blob/v2.102.0/internal/skills/discovery/discovery.go#L206)、[ResolveGitRoot](https://github.com/cli/cli/blob/v2.102.0/internal/skills/installer/installer.go#L309)。验证：源码确认；没有执行真实远程安装或版本解析端到端。
5. 目标例子如下。gh 直接把真实文件写入目标，不像 Skill Zoo 那样先中央安装、再为各 agent 建链接。

   | 选择 | 目标 |
   |---|---|
   | 默认 project/Copilot | `<git-root>/.agents/skills/<name>` |
   | user/Copilot | `~/.copilot/skills/<name>` |
   | user/Claude Code | `~/.claude/skills/<name>`，尊重 CLAUDE_CONFIG_DIR |
   | user/Codex、Cline、Warp、universal | `~/.agents/skills/<name>` |
   | user/Cursor | `~/.cursor/skills/<name>` |
   | `--dir X` | `X/<name>` |

   多 agent 解析到相同目的地时只写一份；不同目的地仍是不同副本。gh 使用 `.agents/skills` 不等于它采用 Skill Zoo 的 SSOT+symlink 模型，也不能由 gh 的路径表证明某 agent 实际读取行为。
   - [registry.go:45](https://github.com/cli/cli/blob/v2.102.0/internal/skills/registry/registry.go#L45)、[目录解析](https://github.com/cli/cli/blob/v2.102.0/internal/skills/registry/registry.go#L411)、[安装写入](https://github.com/cli/cli/blob/v2.102.0/internal/skills/installer/installer.go#L250)。验证：源码确认。
6. **两处元数据写入**：
   - 远程安装改写 SKILL.md 的 YAML `metadata`：`github-repo/github-ref/github-tree-sha/github-path`，以及可选 `github-pinned`。tree SHA 是源目录的 Git 对象 SHA，不是本地文件的实时哈希。
   - 远程安装还调用 `lockfile.RecordInstall`，写 `~/.agents/.skill-lock.json` v3。字段为 `source/sourceType/sourceUrl/skillPath/skillFolderHash/installedAt/updatedAt/pinnedRef`。`skillPath` 记录到 `/SKILL.md`，键为 InstallName，不含安装目的地。**project 安装、`--dir` 安装也写这个全局锁**，因为 RecordInstall 不按 scope/dir 分支。
   - 本地 `--from-local` 是复制；注入 `metadata.local-path`，清除 GitHub provenance；InstallLocal 本身不调用 RecordInstall。复制时跳过源 symlink，文件写入模式 0644。
   - [frontmatter.go:65](https://github.com/cli/cli/blob/v2.102.0/internal/skills/frontmatter/frontmatter.go#L65)、[installer.go:79](https://github.com/cli/cli/blob/v2.102.0/internal/skills/installer/installer.go#L79)、[lockfile.go](https://github.com/cli/cli/blob/v2.102.0/internal/skills/lockfile/lockfile.go)。验证：远程为源码确认；本地复制与 local-path 注入为正式二进制实测。

### A3. 扫描、更新与 symlink

7. `list` 默认扫描注册 agent 的 project/user roots，按目标字符串去重；也可 `--dir`。扫描 flat 与一层 namespace 布局。条目先 `DirEntry.IsDir()`，**技能目录条目是 symlink 时跳过**；并非对整个目录树做 canonicalize 去重。update 扫描器也有相同 IsDir 门槛。
   - 实测：对 `/tmp/.../agent/demo -> /tmp/.../ssot/demo`，`gh skill list --dir agent --json ...` 返回 `[]`，对真实 ssot 根返回 demo。不能推成“gh 完全看不到 Skill Zoo 技能”：默认扫描中的 `~/.agents/skills` 仍能发现 SSOT 实体。
   - [list.go:317](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/skills/list/list.go#L317)、[update.go:523](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/skills/update/update.go#L523)。验证：list 实测；update 同类过滤源码确认。
8. **扫描跳过 symlink 不意味着安装不沿 symlink 写入。** 实测已有目标目录链接时，不加 force 返回 1、要求覆盖授权；`--from-local --force` 返回 0，链接本身保留，目标 SKILL.md 被覆盖并注入 local-path。源 SKILL.md 未变；目标旧 stale.txt 保留；源 0755 脚本的新副本为 0644。这是显式覆盖后的写入，不是任意后台扫描自动破坏。远程 installer 也采用 MkdirAll + WriteFile，沿目录链接写入属于源码确认，未做远程安装端到端。
   - [覆盖检查](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/skills/install/install.go#L1038)、[本地写入](https://github.com/cli/cli/blob/v2.102.0/internal/skills/installer/installer.go#L180)。验证：正式二进制实测 + 源码确认。
9. update 以 frontmatter provenance 为更新依据，不用共享 lock 作为其主要扫描/版本来源。未有元数据：交互询问来源，非交互或 `--all` 跳过；pin 默认跳过。比较保存的远端 tree SHA 与当前远端 tree SHA，**不是检测本地编辑**。更新阶段临时下载、保留目标目录 inode、备份并替换目录内部条目；成功时清除旧版本多余文件，失败尝试回滚。调用 installer 时仍可能写全局锁。
   - 旧档案“update --force 不删本地多余文件”与当前发布源码相反；须区分 install --force 的覆盖行为与 update 的清理行为。
   - [update.go:214](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/skills/update/update.go#L214)、[update.go:407](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/skills/update/update.go#L407)。验证：源码确认，未实测网络更新/故障回滚。

### A4. 与本项目实际碰撞：已复现

10. **gh 写锁会抹掉已有 Skill Zoo 条目的 ref、commitSha，即使新安装的技能完全不同名。**
    - 上游 entry 类型不声明这两个字段；readFrom 用 Go JSON 解码到该类型，writeTo 再序列化整张 skills map。无关条目也经历有损往返。
    - /tmp 中向下载的上游 lockfile 包添加临时测试，调用真实 `readFrom/writeTo`，输入本仓 `fixtures/local-protocol/lock-v3-full.json`；加入 unrelated 条目后重写，断言原 demo 的 `ref`、`commitSha` 都不存在。两项断言通过。
    - 同包第二个测试输入 `lock-v4-future.json`，真实 readFrom 返回空 v3 状态。因此未来版本遇到 gh 写入还存在整表重置风险；这是未来兼容边界，不是当前 v3 全表丢失的实测。
    - [上游类型及读写](https://github.com/cli/cli/blob/v2.102.0/internal/skills/lockfile/lockfile.go#L24)、[本项目锁类型](/Users/alex/Documents/GitHub/skill-zoo/src-tauri/src/services/lock.rs:14)、[当前 fixture](/Users/alex/Documents/GitHub/skill-zoo/fixtures/local-protocol/lock-v3-full.json:1)。日志：`go-lock-tests.log`。
11. **反向也有丢字段：Rust 桌面重写 gh 条目会丢 pinnedRef。** 临时 Rust 程序直接 include 当前生产 `services/lock.rs`，用 gh 形态 JSON 反序列化成 SkillLock，再调用真实 write_to；结果无 pinnedRef。config 路径函数设置为 panic 防止碰真实 home；仅 persistence 的写入原语替换为 /tmp 文件写，未验证桌面原子写入机制。gh 更新 pin 还保存在 frontmatter，因此“锁的 pinnedRef 丢失”不等于“gh 自己立即失去 pin”。本项目 CLI 的对象展开读取会保留未知字段，不能把 Rust 结论笼统套到 CLI。
    - [lock.rs:14](/Users/alex/Documents/GitHub/skill-zoo/src-tauri/src/services/lock.rs:14)、[CLI store.ts:21](/Users/alex/Documents/GitHub/skill-zoo/packages/cli/src/protocol/store.ts:21)。日志：`rust-lock-test.log`，输出：`rust-roundtrip.json`。
12. **后果是实质更新语义损坏，不只是 JSON 美观问题。以下为代码推断，未做桌面 UI 端到端：**
    - 本项目缺 ref 表示默认分支；显式分支丢失后，下一次会按默认分支取树。
    - `commands/settings.rs:1184` 从 commitSha 取更新基线，缺失时 has_update=false；`:1200` 以后用当前远端 SHA 自动补基线，可能把真实旧内容当已是最新，掩盖待更新内容。恢复 commitSha 不能恢复已丢 ref。
    - 同名但不同 repo 的 gh 项目安装会按 name 覆盖全局来源；本项目扫描按目录名关联全局 lock，SSOT skill ID 又含 repo，因此存在错误归因、错误更新源乃至元数据身份漂移的路径。未实测实际改错仓库或星标丢失，不称已发生事故。
    - gh flock 对同一锁文件做原位 truncate/write；Skill Zoo 桌面走本进程 mutex、应用级 TCP lease 和原子文件替换。二者没有共同锁协议，并发可能丢写；本次未做并发复现，且顺序字段丢失已足以支持行动。
    - [缺 ref 语义](/Users/alex/Documents/GitHub/skill-zoo/docs/local-protocol.md:1)、[更新状态](/Users/alex/Documents/GitHub/skill-zoo/src-tauri/src/commands/settings.rs:1184)、[来源关联](/Users/alex/Documents/GitHub/skill-zoo/src-tauri/src/services/skill.rs:1642)、[skill ID](/Users/alex/Documents/GitHub/skill-zoo/src-tauri/src/services/skill.rs:564)、[桌面写入](/Users/alex/Documents/GitHub/skill-zoo/src-tauri/src/services/lock.rs:59)。

## B. 与既有决策记录的异同

已读仓库 AGENTS.md；与议题直接相关的两个研究归档的 proposal/design/verification/tasks，gh 专题档案；并读安装 hardening、custom-agent 协议及早期安装 symlink 边界的相关记录。没有把全部无关竞品档案重新研究一遍。

| 既有裁定 | 本次结论与依据 |
|---|---|
| gh 为“闭源预览命令”，因此不读 cli/cli | **事实错误。** 开源原生命令；错误前提使 filesystem/lock 行为未核实。[原文](/Users/alex/Documents/GitHub/skill-zoo/openspec/changes/archive/2026-10-14-research-competitor-skill-managers-co-design/proposal.md:14) |
| gh 与我方“完全同构”、是 SSOT+symlink 官方背书 | **不成立。** 共用目录仅是交集；gh 不负责为不同目的地建 SSOT 链接，user Codex 已直接装 SSOT。[原文](/Users/alex/Documents/GitHub/skill-zoo/openspec/changes/archive/2026-10-14-research-competitor-skill-managers-co-design/evidence/dossiers/gh-skill.md:27) |
| install/publish/update 是“事实规范” | **价值推断过强。** 官方实现值得研究，但 preview 命令不是跨工具的强制协议。不能据此改变桌面拥有本地协议的原则。[原文](/Users/alex/Documents/GitHub/skill-zoo/openspec/changes/archive/2026-10-14-research-competitor-skill-managers-co-design/design.md:21) |
| tree SHA 更新已实现，零工作量 | **核心事实正确。** 当前 `cli.rs:173,570,1032` 取子树 tree SHA；`commands/skill.rs:982` 比对。旧引用 `skill.rs:977` 不再是当前比较位置。字段名 commitSha 不应为了好看破坏兼容。[裁定](/Users/alex/Documents/GitHub/skill-zoo/openspec/changes/archive/2026-10-14-research-competitor-skill-managers-co-design/design.md:81) |
| 不复制本地 skill、不注入本方 provenance，不做 publish/Code Search | **维持。** gh 的选择不抵消本项目文件所有权约束；收益不足以改变产品边界。 |
| 钉定/校验器已取消，gh 对齐队列清空 | **不因官方命令存在而重启功能队列；但“当前无需技术动作”遗漏共享锁风险。** pin 对可复现环境仍有独立价值，“手动升级”没有证明 pin 没价值；目前也没采用数据足以推翻不做新 UI 的优先级。对 gh 已 pin 条目不能据此忽略其约束。 |
| 只读识别 github-* 决定能否更新 gh 安装技能 | **表述不完整。** gh 已写我方能读的共享锁；SSOT 条目并非全然无法更新。真正缺口是来源归属、pin/ref 与基线语义可靠性。agent origin 当前仍被 `commands/skill.rs:948` 明确拒绝 Git 更新。 |
| update --force 不删多余文件 | **当前发布源码证伪。** update 替换目录内部内容；install --force 才在实测中保留 stale.txt。 |
| BOM、解压限额是待做项 | 后续归档已实现，不能重复立项：`skill.rs:990` 剥 BOM，`cli.rs:871` 与 `skill.rs:1196` 在解压前校验。此处为源码抽查，未重跑仓库全套测试。 |
| Codex legacy 路径迁移已撤销，watch 官方移除读取 | 本次没有重新验证 Codex runtime，故不以历史文字冒充新实测；gh 路径表不能证明 Codex legacy 已移除，也不足以重启路径迁移。 |

另一个更基础的边界：用户背景把 packages/cli 称为 npx skills 重实现并不精确。AGENTS.md 所指的 native Rust 重实现是桌面 `src-tauri/src/services/cli.rs` 的 CliService；`packages/cli` 是 TypeScript companion CLI，共读桌面协议。互操作修复必须同时覆盖两端，不能只改 npm 包。

## C. 技术决策建议

### C1. 四维判断（概率没有采用率统计，不伪造百分比）

| 候选动作 | 触发概率 | 影响面 | 实施成本 | 不做的后果 / 裁决 |
|---|---|---|---|---|
| 纠正文档、写清混用限制 | 已存在错误叙述；研究会继续引用 | 后续决策、支持说明 | 低，小时级估计 | 继续误导；**现在做文档动作** |
| 保护共享锁中的本方更新来源/基线 | 总体混用率未知；在当前版本顺序远程安装并成功写锁的条件下可稳定触发字段丢失，无需同名/并发 | 同一全局锁中的所有 Skill Zoo 条目；显式分支用户更严重 | 中；局部类型补丁便宜，但完整保护涉及协议、恢复及双端测试 | 静默丢分支、抹更新基线；**值得独立 change，优先于功能对齐** |
| 只在 Rust 增 unknown-fields 保留 | 读取 gh 条目后桌面任意锁写回可触发 | gh 扩展字段 | 低 | 解决反向丢字段，但挡不住 gh 丢 ref/commitSha；**作为保护 change 一部分，不能宣称单补丁已兼容** |
| 直接用 skillFolderHash 代替 commitSha 兜底 | 缺基线场景可达 | 更新检测 | 表面低，语义误判成本高 | 不恢复 ref、来源归属，也未证明其他写入者哈希算法一致；**不单独推荐此补丁** |
| gh 同款命令、发布器、Code Search、校验器、pin UI | 具体需求/故障率未证实 | 扩张产品与协议面 | 中至高、持续维护 | 不妨碍现有桌面核心管理；**现在不做** |
| 迁移 Codex 路径或全面加入 native-SSOT 能力位 | gh 的注册表不能证明本方配置失效 | agent 可见性与选择性 | 中至高 | 本次没有新增失效证据；**维持 watch** |

### C2. 建议的具体范围

立项意图限定为：**外部 skills 工具写共享文件后，Skill Zoo 不得静默丢失或改变已安装技能的更新来源、显式 ref 与内容基线；本方不得无端丢弃外部扩展字段。**

纳入：

1. 桌面和 companion CLI 的锁读取、写回、来源归属及恢复规则；unknown fields 无损往返；外部来源不得仅凭同名覆盖本方可信更新身份。
2. 对外部改写后缺失 baseline/ref 的情形做可解释处理，不能把远端当前 SHA 自动盖成“本地已是最新”；无法恢复时明确需要重新确认来源或重装，而不是猜测默认分支。
3. 针对已经存在的 gh pinned 条目明确边界：在尚不支持对应语义时，拒绝本方静默升级该条目，保留原文件及 provenance；这不需要新增全套 pin UI。
4. 顺序往返、不同技能名、同名不同 repo、显式 branch、未来版本、并发协调不兼容及失败恢复的双端回归测试。最小复现要保留到实施 change。
5. 在 design 中比较“本方权威元数据隔离”与“保留共享锁并加可恢复保护”的成本。**单靠 Skill Zoo 保存 unknown fields 无法约束 gh 的有损 writer；单纯 TCP lease 或 flock 也不能单方让另一工具配合。** 若选择隔离权威元数据，限定为本地协议演进，不迁移 SSOT 文件，不创建技能副本；须明确与 npx skills 的兼容和迁移策略。

这是协议兼容问题，不是 SSOT 文件布局错误。不建议现在重构整个安装器、切换到 gh 后端、迁移技能实体目录或接管 gh 更新。最终存储方案应在该有界 change 的 design 阶段决策；本次研究未证明某个具体迁移方案已经安全。

## D. OpenSpec 动作建议

1. **建议立一个 change**，例如 `protect-local-metadata-from-external-skill-writers`；先挂上述复现和范围，proposal → specs delta → design → tasks。不是复活已取消的“gh 语义对齐”大包。
2. 因为涉及 desktop-owned local state 的读取/写回/恢复与兼容语义，按 AGENTS.md 同 change 更新 `docs/local-protocol.md`、desktop fixtures、Rust/CLI 协议测试；只有真正改变 schema 时才设计迁移，不为了适配测试反改 fixture。
3. **文档动作**：保留历史决策，但附日期勘误：闭源、完全同构、当前 update 保留多余文件、遗漏共享锁；将“gh 安装元数据是否识别”改为“共同写入者兼容边界”；为 commitSha 的 tree-SHA 实际语义补文档。纠错本身不需产品行为 change；本次不执行仓库写入。
4. **watch 触发器**：gh 改变锁字段/版本/unknown-field 保留、开始支持目录 symlink 扫描、修改 update 清理和 pin/ref 规则时，重跑隔离用例；Codex 只有出现实际读取兼容变化才重评路径；pin UI 等功能仍由可复现安装需求或无人参与更新需求驱动，不能仅凭 gh 转 GA 自动排期。
5. 不需要独立立项 publish、search、校验器、agent 路径大改。向 cli/cli 提供 unknown-field 保留的最小报告/修复也有价值，但本次没有发 issue/PR；上游接受之前，不能把本地数据保护押在未来修复上。

## 验证边界与产物

- 已实测：旧 gh 2.89.0 和正式 gh 2.102.0 help；本地复制/覆盖/目录链接扫描；上游生产锁函数 fixture 往返和未来版本读取；本方生产 Rust 锁类型/序列化往返。
- 未实测：真实远程 install/update、桌面 UI 完整受损流程、网络失败回滚、并发丢写、Windows junction、各 agent 实际加载规则。因此没有声称“已发生用户数据事故”或“所有 agent 均不可用”。
- 测试只改写 /tmp 中下载的源码/fixture，不改本仓测试或代码；未跑仓库全套测试，也未冒称通过。执行前后 `git status --short` 一致；原有未提交修改保留。
- `go-lock-tests.log`、`rust-lock-test.log`、`rust-roundtrip.json`、`runtime_probe.py` 与 `runtime-probe.log`，以及下载的 `cli-2.102.0/`、正式 `bin/gh_2.102.0_macOS_arm64/bin/gh` 均在本报告同目录。Go 临时测试为上游包内 `internal/skills/lockfile/review_test.go`；Rust 探针在 `rust-probe/`。
