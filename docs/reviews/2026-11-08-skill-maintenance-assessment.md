# 技能维护系统评估（2026-11-08）

前半部分为初评记录；本轮 worth-fix 的最终取舍与修复证据见文末「复核与实施」。初评中的建议不等于全部需要实施。

## 结论与边界

值得按更新、缓存、插件发现三个自然单元整治，不建议重写整个 Settings 或引入通用维护框架。本次为诊断，不改变产品行为，不清理用户真实缓存。工作区开始时干净。性能没有桌面端 trace，不能声称已定位卡顿或给出优化比例。

已阅读 ADR 1、4、6；后续不得为了缩短代码削去本地修改保护、目录替换回滚、跨进程租约或缓存协调。ADR 6 的服务入口原则已经覆盖生命周期写入，但更新仍在 commands/skill.rs 安排守卫与写入，是应进一步核对、收敛的边界。

## 发现与优先级

### P1：清理缓存会删除正在下载的临时文件（实测）

位置：src-tauri/src/commands/settings.rs clear_download_cache；services/cli.rs ensure_cached_zip_from_url。

清理枚举并删除目录内所有普通文件，下载恰好也在这个目录创建 `.repo-*.zip.tmp`。临时文件仍被持有时清理会删掉它。macOS 的真实生产函数复现输出：`active download removed = true, reported freed = 9`，保护断言失败。真实下载后续通过 TempPath.persist 发布这个路径，因此存在下载最终发布失败的风险；未在真实 HTTP 下载中完整复现。Windows 文件占用行为未实测。影响是中断操作，不能推断为已安装技能丢失。

修复应先排除活跃临时文件，再验证完整 ZIP 与安装/读取并发的边界；仅加扩展名过滤不能声称解决所有并发问题。清理失败现在被逐项吞掉，也应给出可靠结果，避免权限失败表现得像成功。

### P1：更新检查结果与实际安装内容没有绑定（代码审查，未端到端复现）

位置：services/cli.rs update_known_skill_entries、reinstall_skill_from_discovered。

检查得到 skill folder SHA；执行重新下载 branch/HEAD ZIP，成功后把先前 latest_sha 写入 lock，没有从实际下载内容核对这个 SHA。检查 A → 上游推进 B → 下载 B → 记录 A，是可达的时间窗口；强制重新下载只能避开旧 ZIP，不能冻结分支。

应让一次更新的检查、下载、落盘、基线属于同一远端快照。folder SHA 不是仓库 commit，不能直接把它塞到 ZIP ref。可选方向：检查保存 repo commit 并下载该 commit；或基于实际下载快照重新核对结果，变化时重检。选择涉及接口/可能涉及本地协议，须按桌面端契约更新规格与必要 fixtures。

另一个失败窗口：每个目录已替换后才批量写 lock，lock 写入失败时目录替换未被这一层回滚。已有目录 rename 回滚不等于目录与 lock 的整笔回滚。应以故障注入验证后再定影响，不把它作为已实测数据损坏。

### P2：无 SHA 时把当前远端当作本地基线（代码审查）

位置：commands/settings.rs check_skill_updates 最后的 baseline_commit_sha。

缺少旧 SHA 并不能证明本地就是今天的远端。当前逻辑检查后补写 latest SHA，可能把有更新误判为最新。baseline_commit_sha 有租约及 expected-entry 比较，避免覆盖竞争写入，这部分应保留；问题是基线语义，并非完全没有并发保护。未知基线应明确呈现，或验证本地内容后建立基线。

### P2：插件发现与普通技能刷新绑定，鲜度却不对称（结构证据，性能待测）

位置：services/skill.rs rebuild_cache / scan_plugin_skills_into；services/watcher.rs collect_watch_roots；SkillMaintenanceSettings.tsx 插件开关。

- 开关成功后 getInstalledSkills(true) 会重启 watcher、扫描普通技能/外部导入/插件、持久化，并返回整份列表；组件丢弃返回值，再 invalidate 读取一遍。后一次通常是读热缓存，不能称作第二次全盘扫描。
- 插件规则遍历所有注册 agent 主目录，深度有限但目录数量没有预算。嵌套主目录可能重复遍历，claimed 仅防重复条目。具体耗时尚未测量。
- 插件已有 spawn_blocking、剪枝、同名去重、跳过内容 hash，不能归结为没有后台执行或没有任何优化。
- watcher 监听 SSOT、agent skills、archive、external，未单独监听插件所在主目录。插件外部更新可能等到手动/其他全量刷新才反映；普通技能 rename/remove 触发全量刷新时又会重新扫描插件。
- InstalledSkills 网格/列表均 sorted.map 全量创建卡片，存在大列表渲染风险；未做 React profiler，不能认定为本次卡顿主因。

先测开关到 UI 可交互、各扫描阶段、条目数/IPC 体积、React commit；再决定扫描复用或虚拟列表。建议把普通技能与插件快照的刷新触发分开，复用现有 refresh 锁，不建第二套真相。关闭应只撤插件条目；开启/手动刷新才发现插件，并明确外部变化的刷新策略。保留泛化发现与只读边界，不能为了速度擅自改成厂商路径白名单。开关还缺少 pending 禁用，快速连续切换的最终状态需测试。

## 缓存盘点与“清理应用缓存”的边界

| 数据 | 位置 | 当前下载清理覆盖 | 建议 |
|---|---|---|---|
| 完整仓库 ZIP | ~/.skill-zoo/cache/repo-zips | 是 | 默认可清，协调活跃使用 |
| 下载临时文件 | 同上 .zip.tmp | 是，存在问题 | 活跃任务排除，孤儿另处理 |
| 仓库元数据 | ~/.skill-zoo/repo-metadata-cache.json | 否 | 可清，协调正在进行的写入 |
| README | ~/.skill-zoo/repo-readme-cache.json | 否 | 可清，清理影响离线回退 |
| 发现页榜单 | Tauri app_cache_dir / skills-sh-*.json | 否 | 可清，保留目录白名单 |
| AI 翻译 | ~/.skill-zoo/translations | 否 | 单列选项，重新生成可能付费 |
| 技能派生索引 | ~/.skill-zoo/skills-cache.json + 内存 | 否 | 使用重建/修复入口，不直接删文件 |
| 用量派生缓存 | services/skill_usage_cache.rs | 否 | 需区分内存派生值与真实历史 |
| 设置、凭证、metadata、lock、imports、archive、更新历史 | 配置/归档目录 | 否 | 不是普通可丢弃缓存，禁止泛删 |

翻译现有 TranslationState.clear 已有 epoch 防止清理前任务写回；统一入口必须复用它。不要递归删除整个 ~/.skill-zoo 或所有 agent 的 cache：后者属于别的应用。WebView 缓存是否值得纳入需要单独盘点，当前未验证，不承诺“一键清除所有缓存”。

前端缓存大小使用 useState + effect，首次读取无 catch；清理后用旧 size 减 freed，不是重新获取实际大小，后台下载会使显示不准。适合改用现有 React Query 查询/失效，不需要新状态框架。

## 最小重构方案与验收

1. **正确性先行**：固化临时文件清理回归；HTTP fixture 验证检查后远端推进；故障注入验证目录替换后 lock 写失败；补未知基线场景。先明确可达影响再修，不混入视觉改版。
2. **更新单元**：services 层统一受守卫更新入口（沿 ADR 6）；IPC 仅参数/结果桥接。前端把检查查询与候选映射放入现有 useSkills hooks，组件负责呈现。保留预检、落盘前漂移复查、force 确认、部分失败、全局完成反馈和历史。把文件搬短不算减少复杂度。
3. **应用缓存单元**：小型显式缓存类别列表，共用统计/清理范围；默认清可重建网络缓存，翻译单列。返回实际统计与失败结果，失效相关查询；不改凭证与用户数据，不先搬目录制造迁移。
4. **插件性能单元**：拿到真实 trace 后拆刷新依赖，先消除不必要重建与丢弃返回值；仍有渲染瓶颈才做虚拟列表。用同一 fixture 比较 0/100/1000 条目的开关与刷新；要求关闭无插件扫描、普通刷新不反复扫描无关主目录、外部变化刷新行为明确。

每个单元单独 OpenSpec change，定义行为、实现、测试、同步主 specs 再归档；不需要先创建通用维护框架。协议变化时同步 docs/local-protocol.md、桌面 fixtures、CLI/Rust 测试。受影响行为通过后再跑项目 gates。

## 本轮验证

- `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml plugin_ -- --nocapture`：7 passed。
- `bun run test src/components/settings/SkillUpdateManagerDialog.test.tsx src/hooks/useBackgroundSkillUpdates.test.tsx`：2 files / 16 tests passed。
- 临时生产函数探针（下面代码）运行后 1 failed，符合复现预期；已从产品源文件移除，场景保存在此，实施修复时应翻转为正式回归测试。
- 没有执行完整测试套件、桌面交互 trace、真实网络更新竞态或 Windows/Linux 测试。没有证据可宣称“无安全漏洞”；本次不是完整安全审计。

复现：临时将下列模块追加至 commands/settings.rs，再执行 `cargo test --lib --features test-helpers --manifest-path src-tauri/Cargo.toml maintenance_audit_probe -- --nocapture`。全部文件位于 tempfile，调用真实清理函数，不触碰用户缓存。

```rust
#[cfg(test)]
mod maintenance_audit_probe {
    #[test]
    fn cache_clear_removes_active_download_temp_file() {
        let tmp = tempfile::tempdir().unwrap();
        crate::config::with_test_home(tmp.path(), || {
            let dir = crate::config::get_repo_zip_cache_dir();
            std::fs::create_dir_all(&dir).unwrap();
            let active = tempfile::Builder::new().prefix(".repo-").suffix(".zip.tmp").tempfile_in(&dir).unwrap();
            std::fs::write(active.path(), "in flight").unwrap();
            let freed = super::clear_download_cache().unwrap();
            println!("active download removed = {}, reported freed = {}", !active.path().exists(), freed);
            assert!(active.path().exists(), "cache clear must preserve in-flight downloads");
        });
    }
}
```

## 复核与实施（worth-fix）

用户授权：重新核验全部初评，只实施值得修的问题。以下结论取代初评的实施建议；不把“代码多”直接当作重构理由。

| 命题 | 真伪与证据 | 概率、影响、成本、不修后果 | 决策 |
|---|---|---|---|
| 清缓存删除活跃临时下载 | 坐实：真实 clear_download_cache 保护断言 red；临时文件路径被删 | 用户同时操作可触发，下载失败可重试；局部低成本，不修持续存在 | 修，保留临时文件和链接/非 ZIP 文件 |
| 清理失败被吞，大小不准 | 部分属实：存在逐文件吞错；前端测试模拟新下载后 size 从 1 KB 变 2 KB，旧代码找不到 2 KB | 大小失真常见于后台下载，影响低；低成本，和缓存修复同单元 | 修，共用可清范围、传播实际错误、重新查询大小；不造应用缓存框架 |
| 检查 A、下载 B、锁记录 A | 坐实：下载快照与候选不同的实际重装阶段测试 red，原实现写入仍成功 | 上游更新/回退窗口概率低，版本错误会影响后续检查；中等成本，一处共享校验覆盖全部更新入口 | 修，不重写更新架构；从解压同一 ZIP 的 git comment 读取 commit，按该 commit 查 tree，不匹配则不写 |
| 更新目录与 lock 失败恢复分离 | 坐实失败窗口：原重装阶段在 lock 故障注入下仍报告成功，原批处理只在全部目录替换后写 lock | 磁盘满/权限故障不常见，但会使内容与基线不一致；局部回滚边界扩展成本中等 | 修，每技能 lock 成功才删备份；普通错误回滚，不承诺崩溃原子性 |
| 未知 SHA 自动补成最新 | 坐实于控制流；新增真实状态构建路径测试确认缺失版本报告 missingBaseline，不冒充最新 | 历史条目或安装 tree 请求失败时可触发，可能永久漏报一次更新；删除盲写成本低 | 修，状态保持未知；详情页显式更新可建立基线 |
| 插件扫描导致卡顿 | 部分属实：真实扫描耗时显著，但没有 UI trace 能确定全部原因 | 本机 2,632 条，冷扫描 4.37 秒/中位 1.15 秒；重写扫描/虚拟化成本高、行为风险大 | 只修已验证的 pending/result reuse；更大性能改造暂缓 |
| 刷新后又全盘扫描一次 | 证伪：后次 getInstalledSkills 通常读热缓存，不是第二次全盘扫描 | 仍有冗余 IPC/序列化，但不能声称省下一次扫描 | 复用返回列表，前端测试锁定只有初始读取+一次 forced refresh |
| 插件开关可连续触发 | 坐实：原测试在 forced refresh 未完成时断言 disabled 失败 | 扫描耗时为秒级，重复点击现实可达；低成本 | 修，hook 持有完整异步流程，开关 pending 时禁用 |
| 插件没有监听变化 | 部分属实：watcher 不覆盖完整插件主目录，但现行规范只要求下次刷新发现 | 自动监听所有 agent 主目录可能带来更多事件和全量扫描；产品行为扩展 | 本轮不做，不以“遗漏监听”直接判定现行契约 bug |
| 没清 README/元数据/榜单/翻译 | 事实属实，“因此必须升级”为缺陷不成立：当前明确是下载缓存 | 扩容涉及离线回退、付费翻译与写入协调；收益未被容量数据证实 | 不做；翻译已有独立清理入口，用量 cache 为内存派生值 |
| Settings/更新层次多，应该全面重构 | 职责分散属实，“整体重构值得”尚未证实 | 搬文件无法提高正确性，广泛迁移副作用高 | 不做；只扩大已有目录回滚边界、复用 React Query |
| 全量卡片渲染应改虚拟列表 | 代码事实成立，症状归因未测 | 需要焦点/滚动/布局验证，不能由条目数直接推导收益 | 暂缓，缺 React profiler 证据 |
| 删除完整 ZIP 与读者间的所有竞争都已解决 | 未成立，本轮只保护临时下载与清理结果 | 返回缓存路径到打开文件仍有既有竞争窗口；不是事务性缓存协议 | 明确保留边界，不宣称解决全部缓存并发 |

### 证据与可复现命令

- 本轮 red：`cargo test --lib --features test-helpers --manifest-path src-tauri/Cargo.toml maintenance_cache_tests -- --nocapture`，`must not unlink an active download`。
- 本轮 red：`cargo test --lib --features test-helpers --manifest-path src-tauri/Cargo.toml update_restores_content_when_lock_publication_fails -- --nocapture`，`a failed lock write must fail the update`。探针打在原重装阶段，原 lock 写入发生在外层批处理；修复后同一生产阶段覆盖替换、lock 发布和恢复。不是声称原探针已模拟完整 HTTP 批处理。
- 本轮 red：`cargo test --lib --features test-helpers --manifest-path src-tauri/Cargo.toml update_rejects_a_different_downloaded_snapshot -- --nocapture`，`must reject a changed snapshot rather than record the checked SHA`；新增 tree 输入测试接缝后、加校验前运行。没有在用户仓库上制造真实上游竞态。
- 前端 red→green：`bun run test src/components/settings/SkillMaintenanceSettings.test.tsx`，新增 pending 和重新统计大小的两项先失败，修复后全部 15 项通过。
- 只读本机计时：`cargo test --lib --features test-helpers --manifest-path src-tauri/Cargo.toml plugin_scan_local_performance -- --ignored --nocapture`，七次 4,374.93 / 1,408.39 / 1,261.17 / 1,110.37 / 1,144.45 / 1,150.05 / 1,087.39 ms，中位 1,150.05 ms。该 ignored benchmark 显式扫描当前注册 agent 的真实目录，但只写 tempfile 设置；不输出文件内容、不修改插件。
- Git archive commit 身份：[Git 官方文档](https://git-scm.com/docs/git-archive)明确 ZIP comment 携带 commit ID；真实只读下载 `https://codeload.github.com/octocat/Hello-World/zip/HEAD` 得到 comment `7fd1a60b01f91b314f59955a4e4d4e80d8edf11d`。新增 ZIP fixture 验证提取内容与身份来自同一文件；未知/无效身份不回退到可变 branch。
- 版本 schema、目录位置与已有字段形状不变。新共享 fixture `lock-v3-unknown-version.json` 同时覆盖未知远端版本和已知本地内容 hash，由 Rust 与 CLI 测试往返保留。

### 权衡与验证边界

更新每仓库新增一次归档 commit 的 tree 请求；其失败/无归档身份会安全阻断更新。成功兄弟项不回滚，保留部分成功语义。末次本地 hash 到 rename 的既有外部编辑窗口、进程崩溃/断电、Windows/Linux 实机行为、UI profiler 均不在本轮实证范围。没有运行任何针对真实用户技能的写入/清理。

### 最终验证

- `bun run test`：53 个文件、484 项通过。
- `bun run cli:test`：13 个文件、132 项通过。首次与前端/Rust 并行时一项未修改的恢复测试触发 5 秒超时；随后完整复跑通过，没有放宽超时或修改该测试。
- `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`：344 个库测试、66 个集成测试通过；4 个 live/performance 测试按声明忽略，doc tests 为 0。最后两处调整（安装不可继承旧 SHA、hash 移到末次漂移复查之前）后，`cargo test --lib --features test-helpers --manifest-path src-tauri/Cargo.toml` 再次 344 passed / 3 ignored。
- `bun run lint`、`bun run typecheck`、`bun run cli:typecheck`、`bun run format:check`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`cargo clippy --manifest-path src-tauri/Cargo.toml --features test-helpers -- -D warnings` 全部通过。Clippy 首次指出新提取函数的一处多余借用，已修复并复跑通过。
- `openspec validate --all --strict`、`adrkit validate --all`、`git diff --check` 通过。主规格新增安全边界与 change delta 一致。
- 另外验证 GitHub tree API 可以直接解析该真实 ZIP 的 commit 身份；没有使用真实用户技能做更新测试。

本轮未引入依赖、没有执行清理真实用户缓存、没有提交/推送或发布。插件扫描算法及卡片渲染未变，因此不能宣称插件开关的扫描耗时已经降低；已消除冗余后续列表请求并防止同页重复操作。

### 开关反馈后续调整

用户确认开关应立即响应。Pending 直接显示本次操作目标，保存确认后更新设置缓存；保存失败回退，扫描失败保留已保存设置，重读也失败时仍保留最后确认值。失败会显式提示一次（hook 自定义 onError 覆盖默认错误提示，因此在该入口补齐）。新增开启/关闭两个方向的失败回归，连同设置 hook 共 34 项测试通过。扫描算法未变。规格记录见 `2026-11-08-show-plugin-toggle-state-immediately` 归档。
