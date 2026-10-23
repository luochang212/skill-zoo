# Tasks

研究交付已完成；本 change 不实施任何修复或功能。判定与论证见 [design.md](design.md)，实证边界见 [verification.md](verification.md)。

## 1. 逐条实证与判定

- [x] 1.1 抓取上游 v1.5.9→v1.7.2 全部 release notes、PR #2067 正文与关键源码（agents.ts、sync.ts、local-lock.ts、skill-lock.ts、README），留痕 [evidence/upstream-release-notes.md](evidence/upstream-release-notes.md)、[evidence/upstream-code-observations.md](evidence/upstream-code-observations.md)。
- [x] 1.2 直读本仓库安装、锁、frontmatter、下载解压链路并留痕 file:line 引用（[evidence/local-code-observations.md](evidence/local-code-observations.md)）。
- [x] 1.3 运行时实证两项：rustc 验证 BOM×trim 行为（坐实我方同款缺陷）；curl 验证 codeload 接受 SHA。方法与断言留痕 verification.md。
- [x] 1.4 对 11 类更新给出坐实/部分属实/不适用判定与四维评估，对三组替代方案完成优劣论证（design.md）。

## 2. 转出：lock 边界核查清单（已于 2026-10-14 核查完毕，结论注记如下）

- [x] 2.1 #2124 更新时迁移已挪动路径的 skill，判定为**缺口坐实但不修**：我方按锁内 `skill_path` 查树，上游改名后报「Skill path no longer exists」（`cli.rs` `known_update_from_tree`、`commands/skill.rs` 单技能路径同）。清晰报错 + UI 两步重装兜底；自动迁移需处理同名叶子歧义（改名后同名新目录可能是不同技能），误指风险与成本大于低频收益。
- [x] 2.2 #1614/#1837 保持非 GitHub 来源 URL 与 host，判定为**结构性不适用**：`parse_repo_query` 硬校验 github.com，锁内不可能出现非 GitHub 来源。
- [x] 2.3 #1357 清理已消失条目，判定为**结构性无害**：我方更新由缓存驱动、缓存由文件系统重建，已删技能进不了更新流程；残留条目惰性（同名重装时被 `update_lock_after_install` 覆盖）。
- [x] 2.4 #2231 尊重锁内路径，判定为**已覆盖**：`skill_path` 贯穿 SHA 查询（`get_folder_sha_from_tree`）与重装（`reinstall_skill_from_discovered`）。

## 3. 转出：后续 change 队列（2026-10-14 更新：B1/B3 已实施归档，A1 勘误后撤销）

- ~~**Codex 路径跟进（A1+A2）**~~：**撤销（勘误）**。openai/codex 源码证实 `$CODEX_HOME/skills` 仍作为 backward-compat User 根被读取（`codex-rs/ext/skills/src/host_roots.rs`，注释「kept for backward compatibility」），我方 `.codex` symlink 机制有效，无受害场景。watch 触发条件：Codex release notes 宣布移除 legacy 读取时，按当时证据重新立项。
- ~~**BOM frontmatter 修复（B1）**~~：已实施（`fix-install-pipeline-hardening`，2026-10-14 归档）。
- **SHA 钉定（B2）**：~~已取消（2026-10-14 产品评审）~~。我方更新流程为「展示变更 → 用户主动逐个升级」，被偷袭升级在交互层不存在，钉定的边际收益（信噪比/供应链）不抵协议扩容（lock 加 pinned 字段）与概念负担。若将来 agent 自管理引入无人参与的批量更新再重新评估。论证见 `research-competitor-skill-managers-co-design/design.md` §2-E。
- ~~**解压上限（B3）**~~：已实施（同 B1，归档）。
- **lock 边界核查（原 B4）**：已完成，见 §2。唯一确认缺口（路径迁移）判定不修，理由留痕。

## Workflow follow-up

- 保持本 change 供评审；不自动 archive。
- 上游 `sync`（C1）维持观望：等其 README 文档化后再评估立项。
