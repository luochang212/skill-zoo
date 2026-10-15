# Proposal

## Why

竞品快筛（豆包清单核验 + GitHub API 星数/活跃度核验）确认了 16 个值得深读的竞品与生态项目，覆盖四个赛道：桌面 GUI（xingkongliang/skills-manager ★6.3k、jiweiyeah/Skills-Manager ★1k、chops ★1.9k、chrlsio/agent-skills ★300、AFunc-OPC/Skiller ★85）、CLI 包管理器（asm ★955、OpenPackage ★618、skillfish ★324、paks ★64）、极客 TUI/micro（skill-man、csm、skm、skill-station、skills-tui）、生态位（obra/superpowers ★299k、GenericAgent ★14.3k、GitHub 官方 `gh skill`）。

其中 xingkongliang/skills-manager 在架构上与我方高度同源（`~/.agents/skills/` SSOT + symlink + SQLite + Rust core + 配套 CLI + agent 自管理），GitHub 官方已携 `gh skill` 下场。只看 README 的快筛不足以支撑「哪些东西值得吸收、哪些看着热闹实则平庸」的判断，必须把仓库克隆到本地逐个读源码，并按 90 分门槛（只吸收能做到 great 的，不卓越不要）产出可吸收清单，汇成 co-design。

## What Changes

- 16 个竞品仓库克隆到本地（`~/Documents/GitHub/competitor-research/`），逐仓深读源码，产出档案（[evidence/dossiers/](evidence/dossiers/)），每个竞品给出借鉴裁定：ABSORB 列表或 NOTHING + 理由。README 声明必须在代码中坐实才采信。
- 90 分门槛三条件（详见 design.md 门槛节，对档案作者同样生效）：原实现是 great（有代码级证据，不是「有这个功能」）；与我方核心架构兼容（文件系统为真相、SSOT+symlink、Tauri IPC 边界、桌面拥有本地协议）；用户可感知收益 > 移植成本。三者缺一 → 进「明确不借鉴」清单并写明理由。
- 汇总产出 co-design（[design.md](design.md)）：吸收项 → 我方模块映射、设计决策、open questions；以及「已评估并拒绝」表（每项一句话理由）。
- 范围界定：vercel-labs/skills 不重复研究（已有 research-upstream-skills-cli-adoption 覆盖）；`gh skill` 为闭源预览命令，按官方文档与手册研究，不克隆 cli/cli。
- （2026-10-15 勘误：「闭源」表述错误——`gh skill` 是 cli/cli 内的开源原生命令（MIT），注册于 `pkg/cmd/root/root.go`。该错误前提导致其文件系统与锁行为未核实：gh 的锁写入对 `~/.agents/.skill-lock.json` 做整表有损往返，剥掉本方 `ref`/`commitSha`（已实测复现）。风险由 `protect-local-metadata-from-external-skill-writers` change 承接，复现证据见该 change `evidence/`。）

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。本 change 是研究交付，`skip_specs: true`，不修改任何产品行为与主 specs。co-design 中的吸收项需逐项独立立项承接。

## Impact

研究依据为竞品仓库源码（本地浅克隆，file:line 引用可复现）与 GitHub 官方文档。此 change 本身不修改产品代码；后续吸收项若触及本地协议（`fixtures/local-protocol/`）或 CLI 联动，须按 AGENTS.md 协议级变更流程独立立项。
