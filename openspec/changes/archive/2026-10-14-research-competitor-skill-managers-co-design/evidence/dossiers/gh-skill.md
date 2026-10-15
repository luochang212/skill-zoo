# gh skill（GitHub CLI v2.90+，2026-04-16 public preview）——文档研究

## 1. 定位与架构（文档）

一句话定位：GitHub 官方将 Agent Skills 纳入 `gh` 的发现/安装/更新/发布命令组，以 GitHub 仓库为分发源、agentskills.io 规范为格式契约。

- 文档：https://cli.github.com/manual/gh_skill （索引）；公告 https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli ；Copilot 侧 https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills 。
- 子命令：`install`（别名 `gh skills add`/`gh skill add`）、`search`、`preview`（别名 `show`）、`list`、`update`、`publish`。preview 状态，「subject to change without notice」。
- 分发模型：**无中心注册表**。search 直接打 GitHub Code Search API 找公开仓库中的 `SKILL.md`（结果含 repo/namespace/path/skillName/stars/description 字段，默认 limit 15，`--owner` 限仓库属主）；publish 产物是 **GitHub release**（打 semver tag + release notes），版本即 git tag/SHA。
- 格式契约：Agent Skills 规范（https://agentskills.io/specification）；发现约定 `skills/*/SKILL.md`、`skills/{scope}/*/SKILL.md`、根级 `*/SKILL.md`、`plugins/{scope}/skills/*/SKILL.md`；隐藏目录（`.claude/skills/`、`.agents/skills/`）默认跳过，`--allow-hidden-dirs` 才扫。

## 2. 功能清单（语义要点，均含文档 URL）

- [完整] install：`gh skill install OWNER/REPO [skill[@version]]`，默认 scope=project、默认 agent=github-copilot（非交互时）。目录决策规则见第 3 节。`--from-local` 从本地目录安装（**复制而非链接**，注入 local-path 跟踪元数据）。安装后把 provenance（repo/ref/tree SHA）写入 SKILL.md frontmatter，随文件走。https://cli.github.com/manual/gh_skill_install
- [完整] 版本钉定：skill 名后缀 `@VERSION`（tag、branch 或 commit SHA）或 `--pin <tag|SHA>`；钉定的技能在 update 时跳过（提示），`--unpin` 解除。安装解析顺序：未钉定→最新 tagged release→默认分支 HEAD。
- [完整] search：Code Search API 全网搜 SKILL.md，`--json`/`--jq`/`--template` 结构化输出，交互模式可就地 install。https://cli.github.com/manual/gh_skill_search
- [完整] preview：渲染 SKILL.md（pager）+ 文件树浏览，零安装；支持 `@version` 与精确路径（`.../SKILL.md` 绕过全树遍历）。公告明确建议先 preview——「skills aren't verified by GitHub and could contain prompt injections」。https://cli.github.com/manual/gh_skill_preview
- [完整] update：扫所有已知 agent 目录，比对 frontmatter 中的 git **tree SHA**（内容寻址，区分真变更与版本号空转）；无元数据的手装技能交互时问 source repo，`--all` 跳过；`--force` 重下恢复原内容（不删本地多余文件）；`--dry-run` 只读。https://cli.github.com/manual/gh_skill_update
  - （2026-10-15 勘误：「不删本地多余文件」与 cli/cli v2.102.0 源码相反——update 以同目录 swap 方式替换内容并清除旧版多余文件（`update.go` `swapDirectoryContents`，注释明言 stale files removed）；实测中保留 stale 文件的是 `install --force` 的覆盖写入，两条路径勿混。）
- [完整] publish：先本地校验后发布为 GitHub release。校验清单：agentskills.io 严格命名规则；skill name 与目录名一致；frontmatter 必填 `name`/`description`；`allowed-tools` 必须是 string 不得为数组；剥离既有 `metadata.github-*` 安装元数据。流程：加 `agent-skills` topic → 选 tag（建议 semver）→ 建 release（自动生成 notes）；`--fix` 自动修（如剥元数据）、`--dry-run` 只校验、`--tag` 非交互。公告另述发布时可启用 **immutable releases**（tag 后内容管理员也不可改）并检查远端设置（tag protection、secret scanning、code scanning）。https://cli.github.com/manual/gh_skill_publish
- [完整] Copilot 侧运行时：project scope 认 `.github/skills`、`.claude/skills`、`.agents/skills`；user scope 认 `~/.copilot/skills`、`~/.agents/skills`；frontmatter 可选 `license`、`allowed-tools`（警告：预批准 shell 等于放开任意命令执行）。docs.github.com add-skills 页。

## 3. 关键语义：install 的目录决策与「host-specific directory」

- `--agent` 决定宿主，`--scope`（project|user）决定层级，`--dir` 自定义目录可同时覆盖两者。
- **project scope 下 9 个宿主共享 `.agents/skills/`**：GitHub Copilot、Cursor、Codex、Gemini CLI、Antigravity、Amp、Cline、OpenCode、Warp；「若多个选中宿主解析到同一目的地，每个技能只装一次」。
- 其余宿主装进各自 host-specific 目录（如 claude-code → `~/.claude/skills/`，user scope；project scope 则项目内对应目录）。
- 这是我方 SSOT 决策的官方背书：`.agents/skills/` 已被 GitHub CLI 认定为 project 层共享目录；user 层则各宿主仍有私有目录——与我方「SSOT + 各 agent 目录 symlink」模型完全同构。
- （2026-10-15 勘误：路径交集≠模型同构。gh 是逐文件 copy 模型，不为各目的地建中央库与链接；user-scope Codex 直装 `~/.agents/skills`。「官方背书」仅指目录约定重合，不构成对 SSOT+symlink 模型的背书。）

## 4. 借鉴候选（90 分门槛）

### 4.1 tree-SHA 内容寻址更新检测 + frontmatter provenance
- 是什么：安装时把 repo/ref/tree SHA 写入 SKILL.md frontmatter，更新时比对 tree SHA 而非版本号。
- 程度：官方实现，含 pinned 跳过、手装技能补元数据、`--force` 语义等完整边界（update 文档）。
- 为何 great：`metadata.github-*` 进 frontmatter 使 provenance 随文件走（复制/移动不丢）；tree SHA 判「内容真的变了」，避免假更新，也避免覆盖本地修改时误判。
- 落点：与我方架构有实质冲突——我方技能目录里不放应用元数据（skill-man 的 sidecar、gh 的 frontmatter 注入都会污染技能文件；且 SSOT 技能要被多 agent 共享，frontmatter 是内容的一部分）。**替代落点**：把「tree SHA 指纹」记在应用侧缓存/元数据存储（键为 SSOT 路径），更新检查逻辑采用「内容寻址优先、版本号其次」的语义；CLI 协议若对齐 gh 的 frontmatter 约定需走完整本地协议变更流程。代价中；收益是 update 语义与官方对齐、可互操作（能更新 gh 装的技能）。

### 4.2 安装/校验语义对照（对照清单，非移植）
- 官方信号应直接被我方采纳为验收基准：① `.agents/skills/` 共享目录约定（已一致）；② 隐藏目录默认跳过的发现约定（`--allow-hidden-dirs` 语义）；③ `@version`/`--pin` 语法（我方 CLI install 语法应对齐，`gh skills add` 别名说明这是用户肌肉记忆）；④ 命名规则校验（name=目录名、小写连字符、`allowed-tools` 为 string）——Rust 侧导入/安装 preflight 加同样校验，错误信息直接引用 agentskills.io 规范；⑤ preview（装前渲染）已在桌面端有对应物，保持。

## 5. 明确不借鉴（带理由）

- publish/release 流水线：skill-zoo 是消费端管理器，发布是 GitHub 的地盘。
- frontmatter 内嵌 provenance：污染技能内容，与 SSOT 共享语义冲突（理由见 4.1）。
- `--from-local` 复制语义：我方本地技能一律链接原目录，绝不复制。
- Code Search 全网搜索：桌面端已有自己的仓库发现通道，且 search 语义属 GitHub 平台能力。

## 6. 借鉴裁定

ABSORB: `@version`/`--pin` 钉定语法与 `gh skills add` 对齐（CLI 层，代价小）、agentskills.io 命名/元数据校验清单（Rust 安装 preflight，代价小）、tree-SHA 内容寻址更新语义（应用侧元数据存储实现，不写 frontmatter，代价中）。
