# 2026-11-20 worth-fix 跟进：zip 测试根因、基线抬高、证伪记录

来源：2026-11-20 全仓 review 跟进轮。本文件记录三项裁决的证据链与结论，供后来者复现推理。

## 1. 证伪：Windows 系统代理导致 loopback 测试失败（撤销前轮 N3 结论）

前轮假设：本机系统代理（127.0.0.1:2080）使 reqwest 把 127.0.0.1 请求送进代理，`ensure_loopback_proxy_bypass` 设的 env `NO_PROXY` 在 Windows 上无效。

**证伪证据**：
- `NO_PROXY='*' cargo test --lib zip_downloads_keep_concurrent` 仍失败 → 代理无关。
- mockito 基础的 `github_api_requests` 测试（同样打 127.0.0.1）通过 → loopback 经 http_client 正常。
- 依赖源码核验（hyper-util 0.1.21 `matcher.rs` `from_system()`）：Windows 分支先调 `from_env()`，env `NO_PROXY` 非空时优先于注册表 ProxyOverride——env NO_PROXY 在 Windows 有效，`4a63950` 的修法成立。

**真根因**（逐层插桩定位）：`wait_for_partial_downloads`（cli.rs，测试辅助）用 `DirEntry::metadata()` 判断临时文件长度。NTFS 上目录枚举返回的元数据（FindFirstFile 路径）对新写入文件的 size 长期陈旧（实测 >10 秒 len=0），而按路径的 `std::fs::metadata()` 立即可见 len=1。同一字节、同一文件，两种读取结果不同。加 eprintln 改变轮询节奏时测试间歇通过——海森bug，无桩时确定性失败。

**修复**：`wait_for_partial_downloads` 改用 `std::fs::metadata(entry.path())`。修复后 lib 312 全绿（含此前必挂的 2 个 zip 测试）。CI 只在 ubuntu 跑后端单测，故此 bug 从未在 CI 暴露。

**边界**：生产代码两处 `DirEntry::metadata().len()`（commands/settings.rs 的缓存大小展示与清理统计）不修——对象是已完成下载、句柄已关闭的 zip，size 在关闭时已提交，无陈旧窗口，且仅影响展示数字。

## 2. 裁决：merge_recovery_test 分隔符失败（属实，测试期望 bug）

Windows 上 `merge_ignores_hidden_agent_copies...` 失败：断言右侧用 `to_string_lossy()`（反斜杠），左侧是缓存条目 home_path（scan_skill_root 经 `normalize_path_separators` 存正斜杠）。归一化是产品侧有意设计（SkillCache::from_entries/upsert 均做），故修测试：期望值套 `normalize_path_separators`。Unix 上两侧相同，CI 无法暴露。

## 3. 决策：浏览器基线抬到 Safari 17 / macOS 14

`toSorted`（InstalledSkills.tsx、SkillSidebar.tsx）是 Safari 17.0 API，高于旧基线 Safari 16.4 / macOS 13.3，属承重路径违反 AGENTS.md 铁律。用户裁决抬基线而非去 polyfill。机器可读归宿同步：vite `build.target: "safari17.0"`、`minimumSystemVersion: "14.0"`、守门测试 `src/browser-floor.test.ts`。注意：Tailwind v4 文档基线（Safari 16.4）低于新基线，Tailwind CSS 产物按渐进处理，AGENTS.md 已注明。

## 4. 不修清单（记录理由）

- N3 代理绕过：证伪撤销，无需修。
- `normalize_repo_skill_path` 无分隔符截断（`mySKILL.md`→`my`）：触发需 lock 的 skill_path 形如 `.../mySKILL.md` 且参与比较，概率极低、后果是分类显示错误，不修。
- `safe_remove` Windows 分支对文件符号链接用 `remove_dir` 会失败：应用自身只创建 junction，仅影响用户手造的文件符号链接，失败会显式报错不损坏状态，不修。
- settings.rs 缓存大小用 `DirEntry::metadata()`：见第 1 节边界，不修。
