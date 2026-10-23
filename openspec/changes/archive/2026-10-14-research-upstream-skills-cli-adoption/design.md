# Design

## Context

我方 `CliService` 是上游 v1.5.3 的 Rust 重实现；上游现处 v1.7.2（2026-10-09），中间约 35 个 release。上游与本项目在架构上已出现两点根本差异，所有「借鉴与否」的判定都要放在这两点之下：

1. **安装粒度与来源**：上游按 skill 粒度做 blob 下载、来源含任意 git host 与任意 URL；我方按整仓 zip（codeload）下载、来源仅 github.com。同一组安全阈值在两边含义不同。
2. **锁的语义**：上游锁按 repo/source 键、记录 per-agent 安装；我方锁按 SSOT 目录键、agent 链接是统一视图（desktop-owned protocol，见 `docs/local-protocol.md` 与 `fixtures/local-protocol/`）。上游一批「per-agent 引用计数」类修复在我方没有同形态问题。

证据：上游侧见 [evidence/upstream-release-notes.md](evidence/upstream-release-notes.md) 与 [evidence/upstream-code-observations.md](evidence/upstream-code-observations.md)；本仓库侧见 [evidence/local-code-observations.md](evidence/local-code-observations.md)。

## Goals / Non-Goals

**Goals:** 每条上游更新给出可复核的判定（坐实/部分属实/证伪）与四维评估；对互为替代的方案论证优劣；产出后续 change 队列。

**Non-Goals:** 不在本 change 实施任何修复；不因「上游有」而照抄，每项判定都以我方架构与真实威胁面为准；不评估上游的 Agent Factory / 遥测等与我方无关的工程实践。

## 逐条判定

| # | 上游项 | 判定 | 裁决 |
|---|---|---|---|
| A1 | Codex 全局路径 → `~/.agents/skills`（#2067） | **勘误：源码证伪**（Codex 仍读 legacy，见下） | **无需变更**；watch Codex release notes |
| A2 | `CODEX_HOME` 等环境变量覆盖 | 坐实缺失 | 撤销：legacy 仍在读，无用户受害场景 |
| B1 | BOM 前缀 frontmatter（#2421） | 坐实我方同款缺陷 | 立即修（卫生级）+ 回归测试 |
| B2 | SHA 钉定（#1439）及显式 ref 语义 | 部分属实 | 值得做独立 change；先补运行时验证 |
| B3 | 解压/下载上限 | 部分属实 | 不照抄数值；解压侧补 zip bomb 上限，与来源扩展捆绑 |
| B4 | lock 健壮性修复集（约 15 项） | 部分适用 | 转核查清单逐条对照（见 tasks），属实的修 |
| C1 | `sync` + 项目锁 `skills-lock.json` | 坐实新协议面 | 观望：等 README 文档化与字段稳定 |
| C2 | `use` 免安装试用 | 坐实 | 产品候选池：桌面「试用不落盘」 |
| C3 | 安装来源扩展（Azure/GitLab/任意 git/归档 URL） | 坐实我方仅 GitHub | 需求驱动排队；依赖 B3 先行 |
| C4 | `add --json` 机器可读输出 | 坐实 | 需求驱动（CLI adjunct） |
| C5 | 安全修复（ext transport / shell spawn / 凭据隔离） | 坐实但**不适用** | 无需动作；记录架构差异即可 |
| C6 | agent 目录扩张（75+，universal 收敛） | 坐实 | 常规维护：按需增补 agent，校准 universal 分类 |

### A1：Codex 路径（核心发现）。**2026-10-14 勘误：原始判定被源码证伪，无需任何变更**

初版判定依据 OpenAI 文档与上游 #2067，认为新版 Codex 不再读取 `~/.codex/skills`，我方 symlink 将静默失效。**经阅读 openai/codex 源码（main，2026-10-14）证伪**：`codex-rs/ext/skills/src/host_roots.rs` `roots_from_layer_stack` 在 User 层**同时**推入两个根，分别是 `$CODEX_HOME/skills`（默认 `~/.codex/skills`，注释原文「Deprecated user skills location, kept for backward compatibility」）与 `~/.agents/skills`，同属 `SkillScope::User`；`codex-rs/ext/skills/src/loader/host.rs:165` 对 User/Repo/Admin scope 均为 `DirectorySymlinkPolicy::Follow`。即：

- 我方 `~/.codex/skills` symlink **继续被当前 Codex 正常发现**，现有配置有效，无需任何变更；
- 发现层无同名覆盖/合并逻辑（`skills/src/name_counts.rs` 仅计数，`host_roots.rs` 的 `dedupe_skill_roots_by_path` 只对同一路径去重），同名技能以多条目共存，这与文档「both can appear」一致；
- 唯一留存事实：legacy 读取被官方标注 deprecated，未来版本可能移除。**watch 触发条件：Codex release notes 宣布移除 `$CODEX_HOME/skills` 读取时，再按当时证据立项**；届时上游（npx skills）面对同一信号，无需预支复杂度。
- 混用工具的同名重复（我方链接于 `.codex/skills` + 同名实体被 npx 装入 `.agents/skills`）为 npx 自身迁移路径的固有现象，现状不动。

初版风险链（升级 → 死链 → 静默失效）**不成立**，予以撤回。以下为初版记录，仅作推理留痕：

> 上游 #2067 引用 OpenAI 成员原话：`~/.codex/skills` 是 legacy，业界标准化于 `~/.agents/skills`（见 evidence）。我方 `config.rs:44` 仍以 `.codex` 为 Codex 的 skills_subdir 并为其建 symlink。风险链：用户升级 Codex → Codex 只读 `~/.agents/skills` → symlink 成死链 → 静默失效。

### A2：环境变量

上游为 claude/codex/hermes 等支持 `*_HOME`/`CLAUDE_CONFIG_DIR` 覆盖；我方全无（grep 为空），仅有 Settings 手工覆盖兜底。用户用 env 重定向 agent home 时我方检测与路径错位。成本低，适合与 A1 同批。

### B1：BOM frontmatter

rustc 实证：`"\u{feff}---…".trim()` 后不以 `---` 开头（U+FEFF 非 White_Space）。我方 `extract_frontmatter`（`services/skill.rs:990`）对带 BOM 的 SKILL.md 返回 None，name/description 静默退化为目录名/空。触发概率低（带 BOM 的 SKILL.md 少见）、影响面小（元数据退化、不阻断安装）、成本极低（解析入口剥一次 BOM）、不修的后果是个别 skill 元数据缺失且难被用户归因。按后悔不对称成立：几分钟成本，消除一类「明明装了却显示不对」的哑谜。上游 #2421 同时提示应在**发现阶段**（`scan_dir`/`extract_frontmatter`）与显示链路统一处理。

### B2：SHA 钉定

实证：安装期，tree URL 中的 40 位 hex 会进入 branch 字段并被 codeload 接受（HTTP 200 实测），即**钉定安装已可偶然工作**；数据面，`SkillLockEntry` 已有 `ref` 与 `commitSha` 字段，更新流程已用 commitSha 做变更检测。缺口在语义：无用户可见的 pin 概念、上游已踩平的边界（显式 ref 绕过快照、同仓不同 ref 不误删、lock 中 ref=SHA 时更新是否保钉）我方未定义，其中「更新是否保钉」未做运行时验证（见 Open Questions）。四维：影响=可复现安装与回滚（真实价值）；概率=中；成本=中（主要是语义与 UI，数据结构已备）；不修=用户只能整仓最新。结论：值得独立 change，先跑运行时验证再定方案。

### B3：下载/解压上限

修正上轮口头报告：我方**有**下载上限（5 GiB，`config.rs:5`），但解压侧无任何上限（`cli.rs:808` 裸 `extract()`）。上游的 10 MiB/25 MiB/1000 files 是为「任意 URL 来源」设计且按 skill 粒度生效；我方按整仓 zip 粒度、仅 GitHub 来源，照抄 10 MiB 会直接弄坏正常安装。威胁建模：攻击者需控制一个用户主动选择安装的 GitHub 仓库；5 GiB 下载上限防呆不防炸弹（高压缩比 zip 可在 5 GiB 内装下远超此量的解压内容）。结论：解压侧补「总解压量 + 文件数」上限是正解，阈值按整仓场景定（实施 change 里给推荐值并测试），且它是 C3（任意 URL 直装）的**前置**，也就是说没有它 C3 就不能做。

### B4：lock 健壮性修复集

架构差异消解了上游最密集的一类修复：上游「keep the lock entry while another agent still uses the skill」（#1786）等 per-agent 引用计数问题，在我方「锁按 SSOT 目录键、agent 链接统一视图」模型下没有同形态（删单 agent=删 symlink，锁不动；全删=删实体+锁，`commands/skill.rs:1306,1754`）。上游「锁键≠目录名」一类我方已有 leaf-name 回退。仍需逐条核查的残余项见 tasks §2（路径迁移 #2124、非 GitHub URL 保持 #1614/#1837、update/uninstall 清理已消失条目 #1357 等）。这些属于「待核查」而非「已坐实缺失」，不预判结论。

### C1：sync / skills-lock.json

坐实为新的上游协议面（647 行 sync.ts + byPackage 归因项目锁），但 README 尚无任何文档章节，这意味着字段与语义仍在漂移期。它管理的「项目需要哪些 skill」与我方桌面管理的「本机装了哪些」正交，不构成对我方 SSOT 的替代；但若我方 CLI 要读写 `skills-lock.json` 求兼容，按 AGENTS.md 属 protocol-impacting change（桌面+CLI+fixtures 联动）。观望理由：文档未定、采用度未知、协议成本高；等上游文档化并稳定 1–2 个 minor 再立项。记录在案即可。

### C2 / C3 / C4

`use` 免安装试用：与我方无冲突，桌面侧映射为「试用不落盘」入口，是差异化的产品候选，进产品池不立项。来源扩展（C3）：我方 `parse_repo_query` 硬校验 github.com host，Azure/GitLab/任意 git URL 均不支持；按需求驱动排队，做之前必须先有 B3 的解压上限。`--json`：CLI adjunct 增强，需求驱动。

### C5：安全修复不适用（架构差异，记录在案）

上游的 ext transport 封禁、update 不经 shell、凭据不进进程，全部针对「跑 git / 起子进程 / 读凭据」的实现。我方安装路径不跑 git、生产代码无 `process::Command`（仅 #[test] 起 bun 验证 lease）、下载走 HTTPS codeload，因此同类攻击面结构性不存在。**这是「不照抄」的正面案例：上游为架构缺陷付的修复成本，我方因架构不同而无需支付。**

### C6：agent 目录

上游 75+ agents 且持续把 agent 收敛为 universal（`.agents/skills`）。我方内置固定 agent 集，按需增补即可（fx、Sarvam、Grok Build、MiniMax、Kimi CLI 等是新出现的）。A1 落地时顺带校准 Codex/Pi/Droid 的 universal 分类与上游一致，避免同一 agent 两边路径不同。

## 替代方案评估

### 1. Codex：上游 native-SSOT vs 我方 `.codex` symlink（**勘误后裁决反转**）

源码证伪后，初版「二选一」的前提消失：Codex **两个目录都读**（legacy 为 backward compat），我方 symlink 机制有效、选择性保留（不建 symlink 即对 Codex 不可见），且无任何用户受害场景。**裁决：维持现状，不做任何变更**。曾评估过的两个激进方向（Codex 转 native-SSOT、内部存储迁出 `~/.agents/skills` 以保广播组下的选择性）一并撤销，因为这些方向的前提是「legacy 已死」，而前提为假。watch 条件见 A1 勘误。

### 2. 解压上限：上游 per-skill 阈值 vs 我方整仓阈值

上游 10 MiB/25 MiB/1000 files 绑定其 per-skill blob 安装；我方整仓 zip 场景下这些数字会误伤。**判定：借鉴机制（解压侧硬上限），不借鉴数值**。实施时应为「解压总量 ≤ f(下载字节) 与绝对上限、文件数上限」的组合，并测大 repo（如 anthropics/skills）不误伤。

### 3. sync 项目锁 vs 桌面全局 SSOT

非替代关系（项目需求声明 vs 本机全局管理），是正交能力。真正的成本在协议面接触：CLI 双写两套锁、fixtures 扩展、桌面展示归因。在上游文档化之前投入，风险是字段漂移导致返工。**判定：观望，不立项**；若未来立项，scope 限定为「CLI 读 skills-lock.json → 按桌面协议安装」，桌面不引入项目级概念。

## Risks / Trade-offs

- A1 若拖延，随 Codex 用户升级，静默失效面逐步扩大；A1 若实施，老版本 Codex 用户的 legacy 路径需过渡策略。这一两难可由实测当前 Codex 行为破局。
- 本研究的我方事实基于工作区未提交状态（c0b0263 + 本地改动）；行号可能随后续提交漂移，判定逻辑不受影响。
- 「不照抄」清单（C5、B3 数值、B4 引用计数类）依赖本文记录的架构差异论证；若我方未来引入 git/shell 安装路径或 per-agent 锁，需重新评估。

## Open Questions

1. 当前发布版 Codex CLI 是否仍读 `~/.codex/skills`（决定 A1 的过渡策略：直切 native 还是双写过渡）。验证方式：装一个 skill 到 `~/.codex/skills`（非 SSOT），观察 Codex 是否发现。
2. 我方更新流程对 lock 中 `ref=SHA` 条目的实际行为（保钉还是回落分支）。验证方式：构造 ref 为 40 位 hex 的 lock 条目，跑 `update_skill_names` 观察下载 ref 与 lock 回写。
3. 前端 src/ 是否存在独立的 frontmatter 解析路径（决定 B1 修复是否需要两处）。
