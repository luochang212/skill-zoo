# Verification

## 已执行检查

- `cargo test --features test-helpers` 全绿(lib 195 通过,各集成套件 4/4/5/12/2/2/15 通过)。本 change 新增 8 个测试:
  - BOM:`extract_frontmatter_strips_leading_bom`(BOM 前缀照常产出 yaml name/description,与前导剥离后结果一致)、`extract_frontmatter_without_bom_unchanged`(无 BOM 行为不变;interior BOM 是内容,不剥离)。
  - 上限纯函数:`archive_limits_reject_ratio_bomb`、`archive_limits_reject_entry_flood`、`archive_limits_accept_normal_and_floor_boundary`(含下限边界:恰好等于派生上限通过,+1 字节拒绝)。
  - 真实 zip 接线:`validate_archive_scale_accepts_normal_archive`、`validate_archive_scale_rejects_real_ratio_bomb`(1 MiB 可压载荷,压缩后仅数 KiB,4x 倍率拒绝、2000x 放行)、`validate_archive_scale_rejects_entry_flood`。
- `bun run test`:30 文件、174 测试全部通过。tasks 3.2 记录的本机 vitest worker 故障在本记录复核时已不复现,174/174 完整跑通。
- `bun run lint`(oxlint 0 告警)、`cargo clippy`、`cargo fmt --check`、`openspec validate --all --strict` 通过。

## 验证边界(诚实标注)

- 「超限不得向磁盘写入任何解压内容」为构造保证:`validate_archive_scale` 只读中央目录(`by_index_raw`)且先于 `extract` 执行,校验失败时解压尚未开始。纯函数测试不触及 extract 侧,故未对空解压目录做独立断言。tasks 2.3 原措辞「解压目录为空」已按此修正。
- install 路径端到端(真实炸弹 zip 走完整 `download_repo_zip`)未复现,需网络/下载注入点;由纯函数测试 + 接线调用点结构审查覆盖。
- 前端 `parseFrontmatter` 不受 BOM 影响(ECMAScript WhiteSpace 含 U+FEFF)为研究 change `research-upstream-skills-cli-adoption` 的实证结论,本 change 未重复断言。

## 归档后补充(2026-10-14)

- 归档后发现主 spec(skill-installation)的「解压下载的仓库归档前 MUST 预校验」为无条件表述,而接线当时只覆盖 install 路径(`download_repo_zip`);Discover 扫描路径 `discover_from_repo` 对下载的 zip 裸调 `extract`,仅受 `MAX_DOWNLOAD_BYTES` 约束。已由后续 `fix:` commit 补齐:`validate_archive_scale` 改 `pub(crate)` 并接入 `discover_from_repo`;常量 `MIN_EXTRACT_BYTES` 更名 `MIN_EXTRACT_LIMIT_BYTES`(如实表达「派生上限的下限」语义,tasks 2.1 的常量名引用随此修正)。
- 新增端到端回归测试 `discover_rejects_archive_scale_limits_before_extraction`:预置 100_001 条目 zip(`MAX_EXTRACT_FILES + 1`)到 `with_test_home` 重定向的离线缓存,调用真实 `discover_from_repo`,断言报 "exceeding the limit"。红→绿已验证:接线前同场景返回 `Ok([])`(缺陷复现),接线后拒绝。倍率向量未做端到端(1 GiB 下限使生产阈值下的小体积倍率炸弹不可构造),由 `validate_archive_scale_rejects_real_ratio_bomb` + 同一接线覆盖。
