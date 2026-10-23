# Design

## Context

研究 change 已实证两处缺陷的根因与本批修复边界（详见其 [design.md](../research-upstream-skills-cli-adoption/design.md)）：

- BOM：`services/skill.rs` `extract_frontmatter` 用 `trim()`，而 Rust 的 `trim` 按 Unicode White_Space 判定，U+FEFF 属 Cf 不属 White_Space，故 BOM 前缀内容 `starts_with("---")` 为 false。前端 `MarkdownContent.tsx` `parseFrontmatter` 用 JS `trimStart`，ECMAScript WhiteSpace 含 ZWNBSP，实证不受影响。因此只需改 Rust 一处。
- 解压：`services/cli.rs` `download_repo_zip` 对下载缓存的 zip 裸调 `archive.extract()`。下载侧已有 5 GiB 上限（`config::MAX_DOWNLOAD_BYTES`），但 zip 炸弹的解压产物可远超压缩体积。

## Goals / Non-Goals

**Goals:** 两处修复各带测试；阈值可测试（纯函数注入参数）；不改变合法仓库的安装行为。

**Non-Goals:** 不做 lock 路径自动迁移（上游 #2124，判定见 tasks）；不改前端；不动下载侧 5 GiB 上限；不引入用户可配置阈值（无此需求）。

## Decisions

### BOM：`strip_prefix('\u{feff}')` 后再 `trim`

在 `extract_frontmatter` 入口剥一个前导 BOM，其余逻辑不动。选 `strip_prefix` 而非通用过滤：BOM 合法位置只有文件头；中间出现 BOM 属内容损坏，不应吞掉。

### 解压上限：预扫描（validate-then-extract），倍数 × 压缩包大小 + 绝对下限 + 条目数

备选方案对比：

- **照抄上游绝对值**（下载 10 MiB/解压 25 MiB/1000 文件）：他们是 per-skill blob 粒度；我们整仓 zip，合法大仓库会误伤。否决。
- **改写 extract() 为手动逐条目流式限额**：需要在热路径重写解压循环，并自行处理 zip-slip、符号链接等 zip crate 已保证的安全属性，回归风险大于收益。否决。
- **预扫描后仍用 `archive.extract()`**（采纳）：解压前遍历 central directory 累加 `size()` 与条目数（廉价、不写盘），超限即报错；通过后照常 `extract()`，zip crate 8.x 的路径消毒与既有行为全部保留。

阈值（`config.rs` 常量）：

- `MAX_EXTRACT_RATIO = 4`：合法仓库解压/压缩比极少超过 4×（文本 2–4×，媒体 ~1×），炸弹 1000×+。留 4× 余量不误伤。
- `MIN_EXTRACT_BYTES = 1 GiB`：绝对下限，覆盖「压缩率 ≈1 的大型媒体仓库」。解压上限取 `max(4 × zip 大小, 1 GiB)`，保证任何通过 5 GiB 下载防呆的正常归档都能解压。
- `MAX_EXTRACT_FILES = 100_000`：防御「海量微条目」型炸弹（条目多而单条小，绕过字节比例）。

校验逻辑抽为纯函数（注入 zip 大小、总解压量、条目数与阈值），单元测试用小数字覆盖炸弹/海量条目/正常三场景；真实 zip 构造测试用注入的小阈值验证不写盘即失败。

### lock 核查结论随 design 留痕（无代码）

- 路径迁移（上游 #2124）：我方按锁内 `skill_path` 查树，上游改名文件夹后报「Skill path no longer exists」。该错误清晰，UI 内两步重装可兜底。自动迁移需处理同名叶子歧义（改名后同名新目录可能是不同技能），误指风险与成本大于低频收益。**不修，留痕。**
- 非 GitHub 来源 URL 保持（#1614/#1837）：安装管线只接受 github.com（`parse_repo_query` 硬校验），锁内不可能出现非 GitHub 来源。**结构性不适用。**
- 幽灵锁条目清理（#1357）：我方更新由缓存驱动、缓存由文件系统重建，已删除技能进不了更新流程；残留条目惰性（同名重装时被覆盖）。**结构性无害。**
- 锁内路径尊重（#2231）：`skill_path` 贯穿 SHA 查询与重装。**已覆盖。**

## Risks / Trade-offs

- 倍数阈值未来可能遇到 >4× 压缩比的合法仓库（如大量高重复文本）；报错信息包含实际值与上限，用户可反馈调整。选明确报错而非静默截断。
- 预扫描为解压前新增一次 central directory 遍历，成本微秒级，可忽略。

## Open Questions

无待决问题。两处根因均已实证，前端免疫已验证。
