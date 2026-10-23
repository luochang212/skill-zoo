# Proposal

## Why

研究 change `research-upstream-skills-cli-adoption` 实证确认了本地管线的两个缺陷：SKILL.md 带 UTF-8 BOM 时 frontmatter 解析失败（与上游 vercel-labs/skills v1.7.2 #2421 同款，rustc 实证），以及仓库归档解压前无任何总量/条目数上限（`cli.rs` 对已下载 zip 裸调 `extract()`，5 GiB 下载防呆不防解压炸弹）。两者都是安装/扫描管线上的静默或高代价边界。

## What Changes

- `extract_frontmatter` 剥离前导 BOM 后再识别 `---`，BOM 前缀的 SKILL.md 照常产出 yaml name/description（Rust 侧；前端 `parseFrontmatter` 经实证不受影响，原因是 ECMAScript WhiteSpace 含 U+FEFF）。
- 解压下载的仓库归档前，按压缩包大小推导的解压总量上限（倍数 × 压缩包大小，设下限）与条目数上限预校验；超限报错、不写入任何文件。借鉴上游机制，不照抄其 per-skill 绝对数值（我们是整仓 zip 粒度）。
- 附带完成 lock 边界四项核查（研究 change tasks §2）：仅记录结论，无代码改动。路径迁移缺口（上游 #2124）有清晰报错与两步重装兜底，判定不值得即修。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `ssot-scan`：新增「BOM 前缀的 SKILL.md 照常解析元数据」要求，识别边界由此扩展到带 BOM 的 frontmatter。
- `skill-installation`：新增「解压前校验归档规模」要求，即在复制边界管线的入口增加规模预校验。

## Impact

实现集中在 `src-tauri/src/services/skill.rs`（BOM）与 `src-tauri/src/services/cli.rs` + `config.rs`（解压上限），各带回归/单元测试；`packages/cli` 与 `fixtures/local-protocol/` 不受影响（锁协议、路径、schema 均不变）。上游对应修复：#2421（BOM）与 #1671 附带的下载/解压上限机制。
