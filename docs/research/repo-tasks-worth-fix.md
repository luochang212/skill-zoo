# 仓库任务菜单与会话状态：worth-fix 复核

日期：2026-11-07。审查基线：`354112f`（v0.4.3 发布后批次终点）。
对象是发布审查中提出的 4 个问题。本次只评估，唯一执行的动作是第 4 项的归档；
以下结论区分实测与静态审查。

## 结论

| 原命题 | 核验结论 | 决策 |
| --- | --- | --- |
| 任务菜单重试在加载中会丢失 force 标志 | 现象存在但不可达，证伪为缺陷 | 不修 |
| 会话任务条目只增不减 | 属实，且是规格定义的产品行为 | 不修 |
| 中间态提交与卡片宽度两连调 | 过程观察，非代码缺陷 | 无可修对象 |
| 两个已完成的 OpenSpec 变更未归档 | 坐实 | 已归档（本审计唯一动作） |

## 1. force 标志

原报告（代码审查）：`useRepoTasks.tsx:129-130` 在有在途请求时直接返回 pending，
`force` 被静默丢弃。代码事实属实，控制流复核后判定不可达：

- `refresh` 恒传 force：`useRepoTasks.tsx:196` 固定 `load(repo, true)`。
- 菜单重试仅在 `!loading && task.query.isError` 时渲染，`loading = isFetching || isPending`
  （`RepoTasksMenu.tsx:98`、`RepoTasksMenu.tsx:133`）。
- 详情页刷新按钮 `disabled={isFetching || isLoading}`（`RepoDetail.tsx:74`、`RepoDetail.tsx:285`）。
- 非 force 的在途请求只可能来自首拉（`queryFn: () => load(repo)`）；首拉期间
  `isError` 为假、`isFetching` 为真，两个触发点都关闭。错误落定时 `.finally`
  已删除 inFlight 记录（`useRepoTasks.tsx:143`），重试触发时 pending 必为空。
- 菜单打开期间下拉模态挡住页面导航；error 态查询 `enabled` 为假，不会自发 refetch，
  不存在"菜单开着、请求自己启动"的窗口。

唯一理论碰撞（非 force 在途 + refresh 调用）需要 UI 在 isFetching 时仍可点击，无此路径；
若 pending 本身是 force 请求，合并到它恰恰是正确语义。加入 pending-force 记忆属于
为不可达场景写 speculative handling，违反项目约定。

验证边界：控制流审查 + 全量测试通过；未做 UI 自动化注入验证，收益低于成本。

## 2. 条目增长

`dismiss` 只置 `dismissed: true` 不删除（`useRepoTasks.tsx:61-70`），entries/progress/notified
随 repo+branch 累积。这正是 background-repository-loading 提案的规格行为
（"retaining an entry until viewed or dismissed"）：条目是会话任务清单，不是缓存。
每条目百字节级，桌面会话重启即清零。清理逻辑需处理在途任务与 dismissed 复活边界，负收益。

## 3. 过程观察

`31c3f85`（移除 toast 按钮）40 分钟后被 `59b6d7e`（移除整个成功 toast）替代；
卡片最小宽度 260→255（`eb58fbd`）→245（`ae74b25`）两连调。端状态自洽，
历史已推送不可改写。仅作未来参考：连续打磨批次的中间态可合并提交，不影响当前代码。

## 4. 归档（已执行）

`openspec list` 显示 `markdown-document-navigation`（7/7 任务）与
`streaming-description-preview`（4/4 任务）均 Complete 但仍为 active。
delta spec 与主规格逐段比对：

- `markdown-document-navigation` 的"Markdown 链接按阅读上下文导航"：
  主规格 `specs/desktop-ui/spec.md` 与 delta 仅差一个尾部空行，其余全等。
- `streaming-description-preview` 的"流式说明及时展示"：
  首轮 diff 显示缺一行，复核为主规格提取脚本截断，原文全等
  （`specs/skill-content-translation/spec.md:210`）。

已归档至 `openspec/changes/archive/2026-11-07-*`，`openspec list` 清零，
`openspec validate --all --strict` 18/18 通过。

## 检查记录（本审计期间）

- `cargo test --features test-helpers` 全部通过。
- `bun run test` 443/443 通过；另一次并发跑出现 3 个 `SkillMaintenanceSettings`
  超时，判定为资源竞争抖动（单独重跑与独立全量跑均通过，且该文件不在本批改动内）。
- `bun run lint`（oxlint）0 警告。
