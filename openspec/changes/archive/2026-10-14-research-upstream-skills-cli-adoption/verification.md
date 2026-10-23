# Verification

## 实证方法与边界

研究基线：本仓库工作区 main `c0b0263`（含未提交本地改动）；上游 main @ v1.7.2（2026-10-09）。抓取时间 2026-10-14。

### 运行时实证（真实验证，非推断）

| 命题 | 方法 | 结果 |
|---|---|---|
| Rust `str::trim()` 不剥离 BOM，故 `extract_frontmatter` 对 BOM 前缀 SKILL.md 失效 | rustc 编译独立程序（`~/.cargo/bin/rustc`），对 `"\u{feff}---\nname: test\n---\nbody"` 调用与生产代码相同的 `trim().starts_with("---")` 序列，并以无 BOM 内容做对照 | BOM 组 `false`，对照组 `true`，命题坐实。程序已删除，方法与断言留痕于此，实施修复时应以同场景翻转断言固化为回归测试 |
| GitHub codeload 接受 commit SHA 作为 zip ref | `curl -sI https://codeload.github.com/vercel-labs/skills/zip/671e8c3…`（v1.7.2 真实 SHA） | HTTP 200，`content-disposition` 文件名含完整 SHA，命题坐实 |
| **（勘误）** Codex 是否仍读取 `~/.codex/skills` | shallow clone openai/codex@main（2026-10-14），直读 `codex-rs/ext/skills/src/host_roots.rs` `roots_from_layer_stack`：User 层同时推入 `$CODEX_HOME/skills`（注释「Deprecated user skills location, kept for backward compatibility」）与 `~/.agents/skills`，同属 `SkillScope::User`；`dedupe_skill_roots_by_path` 仅对同一路径去重；`ext/skills/src/loader/host.rs:165` User/Repo/Admin 均为 `DirectorySymlinkPolicy::Follow` | **初版「新版 Codex 不读 legacy、symlink 静默失效」证伪**，因为两个目录都读，我方 `.codex` symlink 机制有效，A1 裁决反转为「维持现状，无需变更」。官方文档未提及 legacy 不构成「代码不读」的证据：文档 omission ≠ 行为移除，行为以源码为准 |

### 源码直读（file:line 引用，非运行时）

- 上游：`src/agents.ts`（codex 定义、env homes）、`src/skill-lock.ts`（XDG 路径）、`src/local-lock.ts`（`skills-lock.json`、byPackage）、`src/sync.ts` 头部（SyncOptions、`pkg#skill` glob）、README（`use` 命令、下载限制、认证链、75+ agents 表）；PR #2067 正文。均经 `gh api` / `gh pr view` 实抓，原文摘录见 evidence/。
- 本仓库：`config.rs:5,42-47,303-316`、`services/cli.rs:68-77,756-762,808-809,884`、`services/github.rs:31-77`、`services/lock.rs:16-33,109`、`services/skill.rs:990-998`、`commands/skill.rs:1306-1322,1754`。摘录见 [evidence/local-code-observations.md](evidence/local-code-observations.md)。

### 结构验证（控制流审查，未运行）

- 生产代码无 shell spawn / git 调用：全 src-tauri grep `process::Command` 仅命中 `persistence/agent_transaction.rs` 的 `#[test]`；安装链路为 HTTPS 下载 + zip 解压。故上游 C5 类修复（ext transport、shell 注入）不适用。
- 归档与删除链路的锁处理带 rollback（`commands/skill.rs:1700-1760`）。

### 未验证（标注，不以审查冒充实测）

1. 我方更新流程对 `ref=SHA` 锁条目的运行时行为（design Open Questions 2）。
2. 当前发布版 Codex 是否仍读 `~/.codex/skills`（design Open Questions 1）。
3. 前端 src/ 是否有独立 frontmatter 解析（Open Questions 3）。
4. 上游 v1.5.7、v1.5.8 release notes 未抓取（fetch 截断于 v1.5.9）；主题连续，不影响判定。
5. 上游 `sync` 的完整行为仅基于 sync.ts 头部与 release notes，未运行上游 CLI。

### 上轮口头报告的勘误

本研究过程中修正了此前口头汇报的两处偏差，按 worth-fix 记录：

1. 「我方没有字节上限」的说法不准确：下载侧有 5 GiB 上限（`config.rs:5`）；无上限的是**解压侧**。
2. 「SHA 钉定完全没有」的说法不准确：lock 已有 `ref`/`commitSha` 字段与 `update_commit_sha`，缺的是用户可见语义与边界定义，安装期 tree URL 带 SHA 可偶然工作。
