# Design

## Context

`MetadataStore` 是无版本字段的 `HashMap<String, SkillMetadata>`（metadata.rs），`docs/local-protocol.md:36` 明确 metadata.json「非 first-class 版本化协议文件」。ID 由 `make_skill_id`（skill.rs:564）构造：ssot + provenance → `repo:{owner}/{repo}:{dir}`，否则 `ssot:{dir}`；CLI 在 `scan.ts:245-247` 镜像同一逻辑。已核验的安全前提：生产代码无任何处解析 `repo:` ID 反推来源（更新流从 lock 取 source；`classify_discoverable_skill` 按 `entry.directory` 与 provenance **字段**匹配，不碰 ID 字符串）；metadata 无孤儿清理逻辑，迁移不会与清理竞速。

## Goals / Non-Goals

**Goals:**

- 来源漂移不再影响元数据关联（核心场景：lock 丢失 → 全量掉星）。
- 旧数据一次性确定性迁移，迁移后收敛（旧键消失，不依赖每次读取的常驻转换）。
- 双端（桌面/CLI）规则逐字一致，协议 fixture 可验证。

**Non-Goals:**

- 不给 metadata.json 引入版本字段或 v1 协议仪式。该文件本迭代明确不版本化，唯一写者是我们自己，历史格式完全已知，确定性 rekey 即可（这是相对 0.3.56 实验 `4314957` 的核心简化：那边 +1020 行的 v1 协议 + lease 保守迁移，是为「外部工具可能写同一文件」的兼容世界设计的；正道下不存在那个世界）。
- 不改 `agent:`/`external:` 身份（已是位置锚定/注册表锚定）。
- 不做重命名技能的元数据跟随（目录重命名 = 新身份，可接受；做跟随需要新概念，收益不抵复杂度）。
- 不改 lock 的 provenance 字段本身。provenance 继续为显示与更新定向服务。

## Decisions

1. **新 ID 恒为 `ssot:{relative_dir}`，删除 repo 分支**（而非引入第三种前缀）。`ssot:{dir}` 就是今天无 provenance 时的回落格式：多数存量键零迁移，方案里少一个新概念。替代方案「换成不含前缀的裸目录键」被否：破坏既有 `agent:`/`ssot:` 命名空间隔离，迁移面反而更大。
2. **迁移放在读取端（`MetadataStore::load_from`）并持久化**。确定性字符串变换：`strip_prefix("repo:")` 后 `split_once(':')` 取完整 dir（owner/repo 不含 `:`；目录名可能含 `:`，因此只能在第一个分隔符拆分）；与既有 `ssot:{dir}` 条目按 OR 合并（复用 merge 流程 Phase 4 的语义）；有变化则单次原子写回。替代方案「每次读取在内存中映射、不落盘」被否：迁移分支将永远存活且每次读取都要跑，违背收敛目标。写回失败降级为内存态已迁移 + stderr 告警，不阻塞启动。
3. **恢复写回经同一映射函数**（Rust `commands/skill.rs:1985`、CLI `archive.ts` restore）。manifest 里的 `original_skill_id` 是历史记录不改写；写 metadata 时先映射成规范键，保证同会话内即可命中。映射函数单一出处，两端各自实现但由 fixture 锁定行为。
4. **rekey 合并用 OR 而非报错丢弃**。`repo:o/r:demo` 与 `ssot:demo` 并存 = 同一安装在不同时期留下的痕迹，OR 合并是唯一不丢数据的确定性选择。

## Risks / Trade-offs

- [扫描出 `ssot:{dir}` 后，依赖 `repo:` 键形态的外部脚本/用户手工记录会失联] → 我们不承诺外部兼容（ADR 1）；文档同步说明新键形态。
- [迁移写回发生在读取路径上，理论上与另一进程并发写竞争] → 单次原子写（复用 `atomic_write`），与 `set_starred` 同级风险；desktop 与 CLI 同时冷启动的窗口极小，OR 仅保证同一份快照内的标记合并，不提供跨进程事务保证；并发写仍可能覆盖另一进程的新标记，本次不扩展写入协调机制。
- [缓存中遗留的旧 ID（skills-cache.json 持久化了 repo: 形态）在下次重建前仍出现] → 缓存是派生态，重建即收敛；UI 以当前扫描为准。

## Migration Plan

随版本发布自然生效：首次启动读取旧 metadata.json 即迁移并落盘；迁移成功后旧键会从磁盘移除，原始内容没有另存备份；写回失败时磁盘仍保留旧内容，内存态已迁移，下次读取重试。旧版本不保证识别规范键，回退前需备份用户元数据。

## Open Questions

（无）
