# Proposal: fix-install-copy-symlink-handling

## Why

`CliService::copy_dir_contents`（`src-tauri/src/services/cli.rs`）在安装/更新技能、把文件从解压后的 GitHub 归档复制进 SSOT 时，会跟随目录软链接，并把文件软链接的目标按进程 CWD 而非链接所在目录解析。已在本仓库用单元测试直接调用该函数复现（bug 报告 `archived/2026-08-14-bug-report.md` #1）：

- 技能目录里一个指向外部目录的软链（绝对路径，或 `../../..` 爬出解压 tempdir 的相对路径）会让宿主机任意目录被整棵复制进 `~/.agents/skills/<name>/`，并随后被链接到所有 agent 的 skills 目录（本地数据完整性/隐私问题）。
- 有效的相对文件软链（从链接所在目录可解析）被静默丢弃；反之 CWD 下恰好存在的同路径文件会被错误复制进来。

可达性成立：GitHub codeload 归档原样保留仓库 symlink（mode `0120000`），zip 8.6.0 的 `extract` 会将其物化为真实软链接（`zip-8.6.0/src/read.rs:416-420`），monorepo 常见的 `shared -> ../shared` 即可触发，不依赖恶意仓库。

端到端验证（2026-08-14，本仓库实测）：用与 codeload 相同格式构造恶意 zip（symlink 条目 + 绝对/爬出解压目录的相对 target），经项目实际依赖的 zip 8.6.0 `extract` 解压——**三类 target（仓库内、相对爬出、绝对路径）全部原样物化为软链，解压不拦截不报错**（zip crate 的加固只挡"穿过 symlink 写出界"，不挡"物化指向外部的 symlink"）；随后调用真实 `copy_dir_contents`，受害者目录中的文件（模拟 `id_rsa`）被完整复制进安装目标。即"点安装 → 宿主机文件进入技能目录"全链路成立，无需任何代码执行。

勘误：原报告称循环软链（`loop -> .`）会导致栈溢出/整 App 崩溃——实测证伪。递归每层累积一个软链组件，先撞内核单路径解析上限（macOS `MAXSYMLINKS`=32），表现为安装失败加一条误导性 IO 错误，不是崩溃。真正的问题是不该跟随与误解析，而非崩溃。

## What Changes

- `copy_dir_contents` 改为先用 lstat 语义判断软链接，再判断目录：**目录软链直接跳过**（与同文件 `scan_dir` 的既有策略一致）。
- 文件软链接的 target **相对链接所在目录**解析；解析后不存在（悬空）则跳过，存在则复制目标文件内容。
- 增加递归深度上限（对齐 `scan_dir` 的 `depth > 20`），作为纵深防御。
- 补充回归测试：外部目录软链不被跟随、有效相对软链正确复制、悬空/CWD 命中场景不再误拷、循环软链被干净跳过。

## Capabilities

### New Capabilities

- `skill-installation`: 从 GitHub 归档安装/更新技能时，把技能文件复制进 SSOT 存储的文件复制边界（哪些内容允许进入安装目标）。

### Modified Capabilities

（无——`openspec/specs/` 目前为空，本 change 是该能力首个规格。）

## Impact

- 代码：`src-tauri/src/services/cli.rs` 的 `copy_dir_contents`（安装 `add_skills` 与更新 `reinstall_skill_from_discovered` 两条路径共用）。
- 测试：`src-tauri/src/services/cli.rs` 内 `mod tests` 新增回归用例（unix-only，软链创建）。
- 行为变化：含目录软链/悬空软链的仓库此前能"装成功"（带入外部内容或缺失文件），此后这些条目被跳过——对正常仓库无可观察影响（正常技能不含软链目录）。
