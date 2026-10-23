# skill-man（★1|Go|2026-09-09|MIT）

## 1. 定位与架构（实证）

一句话定位：键盘优先的终端工作台，在一个 Bubble Tea TUI 里同时浏览/绑定 Skills 与 MCP 配置，直接改真实文件。

- 技术栈：Go 1.26 + Charm（Bubble Tea/Lip Gloss/Glamour），npm 分发预编译二进制。212 个 .go 文件，分层清晰（`internal/domain` / `internal/service` / `internal/app`）。
- SSOT/分发模型：**没有统一 SSOT**。技能物理存在于「首个可用 agent 目录」或回退的 `.skills/` 目录（`internal/service/skill/installer.go:44-49`）；bind 用相对软链接把技能链接进各 agent 目录（`internal/service/manager/common.go:65`），Windows 有 junction 回退。远程来源（skills.sh registry）安装时**逐个复制进每个选中 agent 的去重目录**（`internal/service/skill/registry_installer.go:50-69` + `registryTargetRoots:86-101`），结果是多副本，必然漂移。
- 形态：纯 TUI（`cmd/skill-man/main.go`，无子命令）。
- 技能来源：本地目录 + skills.sh registry 快照（`registry_installer.go`）；每目录写 `.skill-man.json` sidecar 元数据（`internal/service/skill/metadata.go`，含 source_kind/source_path/installed_at）。
- 真实度：README 宣称「70+ agent layout conventions」，代码里实为 **55 个 agent 定义**（15 个共享 `.agents/skills` + 40 个独立目录，`internal/domain/agent/agent.go`），按 project+home 双 scope 探测凑数之嫌。

## 2. 功能清单

- [完整] 55-agent 注册表扫描：Group A 共享 `.agents/skills`（amp/codex/cursor/gemini-cli 等 15 个），Group B 各自目录（`.claude/skills`/`.hermes/skills` 等 40 个）；仅当目录真实存在才显示该 agent（`internal/domain/agent/paths.go:8-19`）。
- [完整] Skill bind/unbind：幂等、拒绝覆盖非自有软链（`manager/common.go:44-51`）、相对链接 + Windows junction 回退（`common.go:62-72`）；unbind 时拒绝删除非 symlink 目标（`common.go:96-100`）。
- [完整] 共享目录技能的 unbind-relocate：把物理驻留在共享目录的技能 rename 到 `.skills/` 再重链（`internal/service/skill/bind.go:150-169`）。这一做法把 `.skills` 当作项目级 canonical store，与 SSOT 思想暗合但只覆盖 project scope。
- [半成品] MCP 配置管理：解析 JSON/TOML（claude `.claude.json`、codex `config.toml`、cursor `mcp.json`、windsurf 独立路径等，`internal/service/mcp/config_paths.go:44-72`），toggle/bind/remove；但**写入是裸 `os.WriteFile`，无 temp+rename 原子性**（`mutate_json.go:91,106`、`mutate_toml.go:74`、`mutate_claude.go:139`），进程中断可留下半截配置文件。
- [半成品] install/init/update：本地安装为复制，update 是清空目录重写（`internal/service/skill/updater.go:65` `clearDirContents`），无版本/回滚概念。
- [摆设] 「Skills 与 MCP 统一视图」的联动仅限 Tab 切换面板，无数据层关联（一个 skill 引用哪个 MCP 之类的关系不存在）。

## 3. 借鉴候选（90 分门槛）

无。最接近的两项均不过 (a)：

1. 共享目录组去重（Group A）：与 skill-zoo 的 SSOT 模型同源（`.agents/skills` 为多 agent 共享目录），但它只是目录约定的罗列，skill-zoo 已内建更严格的 SSOT+symlink，无可移植增量。
2. agent 目录存在性探测（`paths.go`）：「目录在才显示 agent」是 skill-zoo Settings 可见性已有能力的子集。
3. MCP 管理整体：想法有前瞻性（Skills+MCP 同屏），实现上无原子写入、无备份、无 schema 校验，属「想法好实现烂」，因此进第 4 节。

## 4. 明确不借鉴（带理由）

- MCP 配置管理纳入版图：写的是各 agent 私有活配置（`.claude.json`、`config.toml`），无原子性无备份，事故面大；skill-zoo 的信任资产是「只管 skills、绝不动别的配置」，引入 MCP 会扩大破坏面且与本地协议无关。
- 逐 agent 复制安装（registry install）：多副本漂移，正面违反 SSOT。
- `.skill-man.json` sidecar 藏在技能目录内：污染技能内容本身，我方元数据应留在应用侧存储。
- 55-agent 硬编码表 + 「70+」营销话术：长尾 agent 目录模式收益极低，维护成本高。
- TUI 本身：非我方形态。

## 5. 借鉴裁定

NOTHING：bind/unbind 的工程细节（幂等、拒绝覆盖、junction 回退）在我方 Rust `CliService` 中已应具备且标准更高；其 MCP 一揽子做法是我方应主动避开的反例。它的唯一价值是确认了「Skills+MCP 统一管理」这个用户痛点真实存在，可作为未来独立 OpenSpec change 的需求信号，而非现在的移植对象。
