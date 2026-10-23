# 本仓库代码观察（2026-10-14，基于工作区 main c0b0263）

## Codex 配置

`src-tauri/src/config.rs:42-47`：`AgentConfig { id: "codex", skills_subdir: ".codex", … }`。这表明我方仍以 `~/.codex/skills` 作为 Codex 的 skills 目录并为其建立指向 SSOT 的 symlink。全 src-tauri 无 `CODEX_HOME` / `CLAUDE_CONFIG_DIR` 处理（grep 为空）。用户可在 Settings 对单个 agent 覆盖 `skills_dir`（`config.rs` `agent_skills_dir` 先查 `agent.skills_dir`）。

## 锁文件

- `config.rs:303-316`：锁文件固定 `~/.agents/.skill-lock.json`（与上游回退路径一致；无 `$XDG_STATE_HOME` 分支）。
- `services/lock.rs:16-33`：`SkillLockEntry` 记录 `source/sourceType/sourceUrl/ref(→branch 字段)/skillPath/skillFolderHash/installedAt/updatedAt/commitSha`，可见**ref 与 commitSha 都已有字段**。
- `services/lock.rs:109`：`update_commit_sha(skill_name, sha)`。
- `commands/skill.rs:1306-1322`：`remove_lock_entry_for_skill` 仅对 `origin == "ssot"` 生效，按 `directory → leaf name` 双键回退删除（说明「锁键 ≠ 目录名」已有部分处理）。
- `commands/skill.rs:1754`：归档流程中删除锁条目，带 rollback。

## 下载与解压

- `config.rs:5`：`MAX_DOWNLOAD_BYTES = 5 GiB`；`services/cli.rs:756-762` 下载循环强制执行。
- `services/cli.rs:808-809`：`archive.extract(temp_dir.path())`，此处**解压侧无总字节、无文件数上限**。
- `services/cli.rs:884`：`MAX_COPY_DEPTH = 20` 约束复制递归深度；复制目录对符号链接有外链跳过、环路拒绝等防护（cli.rs 测试 1375-1500 行区间）。

## 安装来源与 SHA

- `services/github.rs:31-77`：`parse_repo_query` 只接受 github.com host；shorthand `owner/repo` 无 ref（HEAD）；URL `/tree/<ref>` 把任意 ≤255 字符、无 `..` 的 ref 放进 branch 字段，因此 40 位 hex SHA 也会被接受。无 SHA 专用语义。
- `services/cli.rs:68-77`：`add_skills(repo_url, skills, preflight_agent_dirs)` → `parse_repo_ref` → `download_repo_zip(owner, repo, branch)` → `archive_zip_url`（codeload）。配合 codeload 接受 SHA 的实证，tree URL 带 SHA 的**安装**走现有管线可行。
- `commands/skill.rs` 测试 `update_repo_info_preserves_missing_ref_as_default_branch`：ref 缺失时更新回落默认分支；`cli.rs:1252` 测试名 `single_update_without_commit_sha_returns_baseline_error` 显示更新流程依赖 commitSha 做变更检测。**「lock 中 ref=SHA 时更新是否保钉」未做运行时验证。**

## frontmatter

`services/skill.rs:990-998`：

```rust
pub fn extract_frontmatter(content: &str) -> Option<String> {
    let content = content.trim();
    if content.starts_with("---") { … }
}
```

rustc 实证（rustc 命令行编译运行，见 verification.md）：`"\u{feff}---\nname: test\n---\nbody".trim().starts_with("---") == false`（无 BOM 对照组为 true）。Unicode 中 U+FEFF 属 Cf（格式）而非 White_Space，`trim()` 不剥，因此**带 BOM 的 SKILL.md 在我方解析为 None，name/description 回退目录名/空**。与上游 #2421 同款。

## shell / git 攻击面（结构验证）

全 src-tauri（非 test 代码）无 `std::process::Command` 调用；仅 `persistence/agent_transaction.rs:313,323` 的 `#[test]` 用 bun 起真实 CLI 验证 lease 互斥。安装路径不经 shell、不跑 git（HTTPS 下载 codeload zip）。上游「block ext transport」「never spawn through a shell」对应的攻击面在我方架构中不存在。

## 前端

未核查 src/ 是否有独立的前端 frontmatter 解析（本研究以安装链路的 Rust 解析为准）。
