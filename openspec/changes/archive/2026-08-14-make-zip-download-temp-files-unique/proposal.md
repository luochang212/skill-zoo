# Proposal: make-zip-download-temp-files-unique

## Why

`ensure_cached_zip_with_progress`（src-tauri/src/services/cli.rs:731-735）下载仓库 ZIP 时，临时文件路径对同一 owner/repo/branch 是固定名（`.{owner}--{repo}--{branch}.zip.tmp`）。`File::create` 以 O_TRUNC 打开，多个并发下载会互相截断并交错写入同一文件，最终被 `rename` 进缓存的是损坏的 zip。缓存命中窗口最长 24h（或直到 force），期间该仓库的安装/更新持续报 `Invalid archive`，且错误信息无法指向真实原因。

已核实的并发调用方（全部为 async tauri 命令，可并发执行）：

- `preview_skill_md`（commands/skill.rs:2944）→ `ensure_cached_zip(..., false)`
- `discover_from_repo`（services/skill.rs:1120，getRepoSkills 底层）→ `ensure_cached_zip_with_progress(..., force)`
- `add_skills`（安装）→ `download_repo_zip` → `ensure_cached_zip(..., false)`
- `update_known_skill_entries`（更新）→ force=true

真实场景：用户在 Discover 页预览某仓库的同时点击安装该仓库，或刷新仓库面板与安装并发。固定 tmp 路径 + O_TRUNC 截断使两路写入交错，产出损坏文件。

## What Changes

- 下载临时文件改为每次调用唯一命名（进程 id + 纳秒时间戳后缀），并发下载互不干扰。
- 完成后仍 `rename` 到固定缓存路径——并发完成时后者覆盖前者，二者同为完整归档（同 owner/repo/branch 内容一致），最终缓存始终是完整文件。

## Capabilities

### New Capabilities

- `repo-zip-download`: 从 GitHub 下载仓库 ZIP 归档的缓存写入，必须保证并发下载互不损坏，且最终缓存条目始终是完整归档。

### Modified Capabilities

（无。）

## Impact

- 代码：`src-tauri/src/services/cli.rs` 的临时路径生成（提取为私有函数以便测试）。
- 测试：新增"临时路径唯一性"单元测试（并发/连续调用产生不同路径）。
