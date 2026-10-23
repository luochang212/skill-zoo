# Proposal

## Why

SSOT 技能的用户元数据（stars、isMine）按 `repo:{owner}/{repo}:{dir}` 这种把安装来源编进 ID 的键存放。lock 丢失或损坏（单个文件，损坏即全量触发）、repo 改名、跨源重装都会造成来源漂移；一旦漂移，ID 就变成 `ssot:{dir}`，元数据查不到，用户的星标和"我的技能"标记静默丢失且不会自愈。这与「文件系统是事实源、缓存可重建」的核心设计正面冲突：恰恰是重建路径会触发丢失。经代码控制流审查坐实（`make_skill_id`，skill.rs:564；元数据迁移只存在于显式 merge 流程）。

## What Changes

- SSOT 技能 ID 恒为 `ssot:{relative_dir}`，不再把 provenance 编进 ID；provenance 仍由 lock 与缓存字段承载（显示、更新定向不受影响）。
- metadata.json 读取时执行一次性确定性 rekey：`repo:{owner}/{repo}:{dir}` → `ssot:{dir}`，与既有同名 `ssot:` 条目按 OR 合并；`agent:`/`external:` 键不变。rekey 结果持久化，使旧键收敛消失。
- 归档恢复写回元数据时，把 manifest 里的历史 `original_skill_id` 过同一把 rekey 再落键，保证同会话内即可挂上。
- CLI 镜像同步：`scan.ts` 的 ID 构造移除 repo 分支，metadata 读取/写回应用相同 rekey 规则。
- `docs/local-protocol.md` 与协议 fixtures 同步；metadata.json 维持「非 first-class 版本化协议文件」定位，不新增版本字段。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `local-protocol`: 新增「用户元数据身份锚定安装目录」要求，涵盖身份规则、旧键 rekey、恢复写回映射、双端一致性。

## Impact

- `src-tauri/src/services/skill.rs`（`make_skill_id` 及两处调用）、`src-tauri/src/persistence/metadata.rs`（rekey 迁移）、`src-tauri/src/commands/skill.rs`（恢复写回点 :1985）。
- `packages/cli/src/protocol/scan.ts`（ID 构造 :245-247）、`packages/cli/src/protocol/store.ts`（metadata 读写 rekey）、`packages/cli/src/protocol/archive.ts`（恢复写回）。
- `fixtures/local-protocol/`（新增 legacy metadata 键 fixture）、`docs/local-protocol.md`、双端协议测试。
- 兼容性：对用户无破坏。旧 metadata.json 在首次读取后自动迁移；归档 manifest 中的历史 ID 是合法历史记录，通过 rekey 映射而非改写。
