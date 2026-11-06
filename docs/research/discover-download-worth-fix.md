# 发现页搜索与下载：worth-fix 复核

日期：2026-11-06。审查基线：`eb58fbd7fbc60492cd4ac331c7199aede08e8934`。
本次只评估，不修生产代码；以下结论区分实测与静态审查。

后续实现与补充实测见文末“修复验证”；正文保留修复前评估的证据边界。

## 结论

| 原命题 | 核验结论 | 决策 |
| --- | --- | --- |
| 搜索过滤会误删合法的含点号仓库 | 实时来源样本和 GitHub 存在性已实测；应用过滤路径静态确认，未调用完整 Tauri command | 值得局部修复，优先于下面三项；低严重度的搜索遗漏 |
| 下载失败会遗留临时文件 | 部分属实：仅创建临时文件后的特定错误路径；控制流确认，未故障注入实测 | 值得局部修复；低严重度的磁盘卫生问题 |
| 重复解压流程应该立即合并 | 重复属实；“现在值得重构”的收益证据不足 | 暂不单独重构，有共同语义变更时再考虑 |
| command 层业务太多，应该迁移 service | 职责集中属实；尚未证明造成实际缺陷或变更障碍 | 暂不单独搬迁，不以文件长度作为重构理由 |

## 1. 搜索过滤

生产路径：`commands/skill.rs::search_skills_sh` 请求 skills.sh，解析来源，再通过
`owner.contains('.') || repo.contains('.')` 排除结果。该规则把域名识别和仓库名
合法性混为一谈。`services/github.rs::parse_repo_query` 已允许仓库名包含点号。

实时只读请求 `https://skills.sh/api/search?q=dotfiles&limit=100` 返回 100 条结果，
其中来源包括 `citypaul/.dotfiles`、`dmmulroy/.dotfiles`。
分别请求 `https://api.github.com/repos/<source>`，两者均返回 HTTP 200，
`full_name` 与来源一致，默认分支均为 `main`。
另抽查 `skills`、`claude`、`agent` 各 100 条，不能据此推算整体发生率。

可重复的数据核验（不复制应用过滤逻辑）：

```sh
python3 - <<'PY'
import json, urllib.request
url = 'https://skills.sh/api/search?q=dotfiles&limit=100'
with urllib.request.urlopen(url, timeout=15) as response:
    sources = {s['source'] for s in json.load(response)['skills']}
for source in ['citypaul/.dotfiles', 'dmmulroy/.dotfiles']:
    print('in search:', source, source in sources)
    request = urllib.request.Request(
        'https://api.github.com/repos/' + source,
        headers={'User-Agent': 'skill-zoo-worth-fix-audit'},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        print(response.status, json.load(response)['full_name'])
PY
```

触发概率：取决于查询，已有真实样本；影响：这些来源不出现在关键词结果中。
最轻是搜索普通仓库完全不受影响；常见后果是受影响来源被遗漏；如果结果都来自
这些仓库则可能显示空列表。没有证据表明它造成数据损坏或越权。
用户可用 `owner/repo` 直接走仓库查询绕开过滤，故不是仓库完全无法使用。
不改会持续漏结果，不会自行恢复。

成本低、结果可观察，值得修。最小方向是区分非 GitHub 来源与合法仓库名，
复用既有仓库解析约束；不能简单删除全部来源校验。
修复时应以这两个真实来源固化生产映射路径的回归场景，并覆盖域名来源仍被排除。
不需要搜索框架重构。

验证边界：未调用完整生产 command。映射循环内嵌在 command 中，依赖 Tauri State、
固定 URL 和进程共享 client，没有可直接传入来源响应的接口。本次未为评估而改造
生产接口，也未用复制的过滤逻辑冒充复现。结论来自实时输入证据与控制流的结合。

## 2. 下载临时文件

生产路径：`services/cli.rs::ensure_cached_zip_with_progress`。
临时路径是普通 PathBuf，文件是 `std::fs::File`，均不负责删除落盘文件。
创建后，流读取错误、`write_all` 错误和最终 rename 错误均直接返回；只有超出
下载大小限制的分支显式尝试删除。正常成功则 rename 成正式缓存。

需要收窄上一轮说法：请求发送失败、HTTP 非成功状态在创建文件前返回，不会产生
这种残留。已写入部分数据后失败才可能留下有体积的文件；写盘失败也可能只留空文件。
重试使用不同临时文件名，不会自动接着写旧文件。

`commands/settings.rs::clear_download_cache` 会删除缓存目录内的普通文件，包含
这些残留；设置页 `SkillMaintenanceSettings` 已接入该操作。
缓存的 24 小时判断只是正式缓存的复用判断，不是临时文件的自动清理任务。

触发概率没有遥测，不能量化；影响限于下载缓存，未发现残留被当作已安装 Skill。
最轻是残留空文件；部分下载失败会占用相应磁盘空间；反复失败的大下载可能累积
较多空间，但本次没有测量磁盘耗尽，也不把它表述为必然结果。
不改则残留持续存在，直到用户清缓存或手动删除。

成本低，值得以已有 tempfile 的生命周期管理补齐错误返回清理；无需新下载管理器。
实现时保留大小限制、进度、唯一临时文件及 Windows 关闭句柄后发布的要求。
这是卫生修复，不是紧急安全问题。

验证边界：未对生产下载函数注入断流或写盘失败。下载 URL 固定为 GitHub HTTPS，
client 是 OnceLock 中的共享实例，现有测试隔离 HOME 的机制不能替换下载响应。
现有 CONNECT 失败测试只能覆盖创建临时文件之前的失败，不能证明这里的残留。
本次不改系统信任或真实缓存，也不复制下载循环做模拟。以上为控制流结论。
后续修复应保留“写入部分响应后断流，返回错误且无临时文件”的回归场景，
并验证成功发布和并发临时文件隔离。

## 3. 重复解压

`CliService::download_repo_zip` 与 `SkillService::discover_from_repo` 都会打开 ZIP、
校验规模、解压到 TempDir、寻找根目录。重复可直接从代码确认。
但下载缓存、`validate_archive_scale`、`normalize_extracted_repo_root` 已共享。
发现路径还有阶段事件、完成事件、描述解析；安装路径有自己的输出和错误语义。
不能把整条流程当作完全相同的逻辑合并。

现有 `discover_rejects_archive_scale_limits_before_extraction` 测试调用真实发现入口，
证明文件数量超限在解压前被拒绝。本次全量测试也覆盖两条路径各自的根 Skill 规则。
尚无证据表明两套解压代码已经造成语义漂移或用户故障。

不改的代价是未来共同解压规则需更新两个位置；立即抽取则需要维护 TempDir 生命周期、
事件顺序和错误行为。收益有限、修改面大于前两项，现阶段不值得单独重构。
纠正上一轮“应立即合并”的建议：保留为未来共同语义修改时的选择。

## 4. command 层职责

`commands/skill.rs` 内确有 skills.sh 请求、结果映射和元数据/README 缓存实现。
但它们仍遵守 Tauri 安全边界，前端未因此直接碰网络或文件系统。
`visible_discover_conflict_cache` 还需要 AppState 中的设置和本地缓存，协调不可能
简单地全部消失。行数包含测试，不能直接作为架构失效的证据。

目前没有第二个调用方复用需求，也未证明仅搬到 service 能修复上述问题。
不改主要是导航和维护成本；立即拆分会产生大量移动、接口与 review 成本。
故不单开重构。如果实际修搜索映射需要纯函数测试入口，可以做最小提取，
但不顺带迁移 README、元数据缓存和其他 command。

## 验证记录

- `bun run test`：47 个文件，432 项通过。
- `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`：
  315 项单元测试与 60 项集成测试通过；2 项性能测试按默认设置跳过。
- 上一轮的 CliService 定向测试也已结束：48 项通过。
- 没有修改生产代码或增加声称修复缺陷的测试；全套通过只能说明现有场景通过，
  不能证明未覆盖的搜索过滤和下载错误清理正确。
- 未做桌面 UI 端到端操作、生产断流/磁盘失败注入及 Windows/Linux 实机验证。

## 修复验证（2026-11-06）

用户授权修复后，仅处理前两项。搜索命令调用提取出的 `parse_skills_sh_source`，
保留域名来源排除并复用既有 GitHub 段校验。下载仍通过原有公开入口请求 GitHub；
私有 URL 参数入口供本地 HTTP 测试复用真实下载循环，不增加应用配置。
普通临时文件改为 NamedTempFile，关闭句柄后通过 TempPath 发布；错误和 future
丢弃时由所有权自动清理。原有缓存、限流/大小错误与进度事件保持原有路径。

先用旧逻辑跑新增断言，观察到以下失败：

- `skills_sh_source_accepts_dotted_repository_names`：`.dotfiles` 实际被拒绝。
- `skills_sh_source_rejects_domains_and_malformed_pairs`：`owner/` 实际被接受。
- `zip_download_cleans_partial_responses_and_cancelled_downloads`：确认部分响应已经写盘后，
  服务端在未满足 Content-Length 时关闭连接；下载报错，目录仍有 1 个文件，期望 0 个。
- `zip_download_cleans_failed_publication_and_replaces_complete_cache`：以目录占据目标路径，
  发布失败后目录包含目标与残留临时文件共 2 项，期望仅目标目录 1 项。

修复后本地 HTTP 定向测试通过，覆盖断流、future 丢弃、发布失败和成功下载。
并发测试让同一仓库的两个真实下载同时写入各自的非空文件，随后释放余下响应；
两个调用均成功，最终目录只有一个正式缓存，ZIP 条目可读取且内容正确。
这些是对真实生产解析器和下载实现的确定性测试，补足上文的静态审查边界。
没有模拟磁盘耗尽、权限错误或进程崩溃；不承诺异常终止后的自动清理。

修复后的完整检查：

- Rust 全套：319 项单元测试、60 项集成测试通过，2 项性能测试默认跳过。
- `bun run lint:rs`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` 通过。
- `bun run lint`、`bun run format:check` 通过；本次未修改前端，未重复前端全套测试。
- `openspec validate --all --strict`、`adrkit validate --all` 通过。
- 额外 `cargo clippy --manifest-path src-tauri/Cargo.toml --features test-helpers --all-targets -- -D warnings`
  未通过：诊断均来自未修改的旧测试，位于 `commands/agents.rs`、`commands/settings.rs`、
  `persistence/metadata.rs`、`services/skill.rs` 和 `tests/protocol_fixtures_test.rs`。
  本次新增解析器和下载测试无 Clippy 诊断；没有为清理历史测试告警扩大修改范围。
