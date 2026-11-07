# Discover UI audit: worth-fix assessment

基准：`91fe246`。仅评估五项报告，不修改产品代码；用户明确确认 Install (N) 是主动删除，三行社区骨架是明确要求；后续复核选择保留二态全选、不提示旧缓存，并用关闭重开预览作为重试入口。

## Evidence

运行临时观察测试：`bun run test src/components/skills/AuditFindings.audit.test.tsx --maxWorkers=2`，5/5 通过。测试直接挂载生产组件，只替换其数据 hooks 和不相关子组件，没有复制待审逻辑、联网或修改用户数据。观察测试断言的是当前行为，不是修复后的回归断言；脚手架存于 `/tmp/skill-zoo-audit-observations.test.tsx`。以下场景供后续修复转为反向断言。

| 报告 | 核验 | 决策 |
| --- | --- | --- |
| 旧社区缓存无提示 | 对同一 CommunitySkills 实例，依次提供相同技能、旧时间戳/stale=true 与新时间戳/stale=false，渲染 DOM 完全一致。后端源码确认：缓存超过一小时后尝试刷新，刷新失败才回退旧缓存，回退无最大年龄；未实测真实断网请求。 | 现象属实，但用户明确认为该附加功能无需旧数据提示，保持现状。不是所有请求都返回过期数据。 |
| 全选框缺半选态 | 两个 Agent 默认仅选中第一个，全选框 aria-checked=false/data-state=unchecked；取消第一个后仍完全相同。 | 现象属实，但用户明确选择二态全选，保留现状，不增加 mixed 图标或样式。 |
| 列数公式和三行导致跳变 | 900px（三列）时生产组件渲染 9 张骨架，数据返回后默认渲染 12 张实际卡片，即三行变四行；未做浏览器像素高度/CLS 测量。公式 (width+12)/292 与当前最小列宽 280、间距 12 一致。 | 部分属实。行数变化可观察，但三行是用户要求，不应撤销；未复用按视口高度计算的 skeletonCount 不是独立缺陷。若确实影响体验，可让初始结果也显示三行，否则不必改或另建抽象。 |
| Install (N) 丢失 | 多技能输入的按钮确实为 Install，但点击仍提交全部两个技能 key。提交 9bd9910 明确将计数文案换成普通安装；用户再次确认该变动主动要求。 | 缺陷判断证伪，保留产品选择，不恢复计数。 |
| 仓库查询失败后预览一直加载 | 将 useRepoSkillList 置于重试耗尽的终态（data=undefined/isError=true/isLoading=false），点击真实社区卡片，预览仍暴露 loading progressbar，没有错误信息。BrowseSkills 只解构 data，以 !previewRepoSkills 判断加载，也不转发该查询错误。 | 加载终态误判属实，但“没有重试入口”不准确：点击遮罩关闭后重开会重新查询。无需新增重试按钮；最多只修调用处的终态错误与 loading 映射。不是共享面板自身没有错误分支。 |

## Attribution and boundaries

`git blame` 显示 BrowseSkills 的仓库查询与 loading/error 映射来自 `7b27831a`；`0c5591d` 提取共享预览组件时 RepoDetail 已正确转发其内容查询错误。报告的提交归因不准确。

第五项复现的是“查询终态已确定后，UI 错误映射丢失”，没有重复跑网络重试时间线；不声称断网一定永久无法恢复（重新打开、重试或重新聚焦后成功请求可能恢复）。第三项只验证 DOM 数量变化，不将其夸大为已实测的滚动跳动。

最终建议：不因这份审计恢复安装计数、增加半选态、缓存提示或更多按钮。仅可考虑修正预览失败后仍显示加载的状态；重试沿用遮罩关闭后重开。固定三行保持，不为复用一行列数公式另开重构。

## Reopen retry verification

补充运行 `bun run test src/hooks/preview-reopen.audit.test.tsx --maxWorkers=2`，1/1 通过。真实 useRepoSkillList + TanStack Query：第一次请求失败进入 isError，关闭将 owner/name 置 null，重开恢复同一 owner/name，第二次请求成功。关闭真实网络，用 retry=false 直接模拟重试耗尽后的终态；查询函数调用次数由 1 增至 2，证明关闭重开确实是现有恢复入口。脚手架存于 `/tmp/skill-zoo-preview-reopen.audit.test.tsx`。
