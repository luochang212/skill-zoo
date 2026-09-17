## Context

见 `proposal.md` 的 Why。技术约束（决定下面每个选择）：

- 运行环境是系统 WebView（macOS WKWebView / Linux WebKitGTK 4.1 / Windows WebView2），`tauri.conf.json` 未设 `minimumSystemVersion`，因此 guide 的 Baseline 只能当上限，任何新特性都要么有全引擎支持，要么有降级。
- 仓库已自建 primitive 层（Radix + Tailwind v4 + tailwindcss-animate + framer-motion）。能用既有 primitive 或既有模式解决的，不引入新依赖、不引入并行实现。
- 测试基础设施：vitest + jsdom + `@testing-library/react`，setup 里已 mock Tauri `invoke`；组件测试与组件同目录（`*.test.tsx`）。jsdom 不做布局与绘制，所以"动画是否真的动"这类命题只能验证到"过渡属性与位移属性一致"，不能验证像素。
- 主题状态的既有事实：`localStorage["theme"]` 与后端设置 `theme` 是权威持久化，`useTheme()` 的 `useState` 只是设置页内的局部视图状态（`App.tsx` 只调用 `applyTheme`，不调用 hook）。

## Goals / Non-Goals

**Goals**

- 让 `specs/desktop-ui/spec.md` 中每条 Requirement 都有对应的红→绿回归测试，且这些测试断言的是可观察行为而非实现细节。
- 修复动作尽量"净删代码"或与既有模式对齐，不新增依赖。

**Non-Goals**

- 不处理需要运行时性能打点或真实浏览器评测的条目：markdown 每键重解析（`SkillContentPane`）、搜索逐键全量过滤（`InstalledSkills`）、卡片网格 `content-visibility`。它们连同判定依据列在 `verification.md` 的"未纳入本次修复"一节。
- 不改造 `packages/cli/wui/` 的手搓模态为原生 `<dialog>`。那是另一个界面、另一套运行时（真实浏览器），且需要重写 toast 定位与降级路径，独立立项更合适。
- 不修 guide 建议中在本项目属回退的条目（`overlay` 过渡、`closedby`、Temporal 等），理由已记录在审计报告第 8 节。

## Decisions

### D1. 位移过渡用 `transition-[translate,opacity]`，不改用 `translate-x-*` 之外的结构

Tailwind v4 把 `-translate-x-full` 编译为独立属性 `translate`（已在 `dist/assets/*.css` 中核实），因此当前 `transition-[transform,opacity]` 与实际变化属性不匹配。选择显式列出 `translate` 而不是改成 `transition-transform`：后者虽然也覆盖 `translate`，但会同时声明 `transform`/`scale`/`rotate` 三个不会变化的属性，语义更宽且会掩盖同类错误。

`willChange` 同步改为 `"translate, opacity"`，否则浏览器仍按不会变化的 `transform` 做图层提示。

*备选*：给元素加内联 `transform: translateX(...)` 并保留 `transition-transform`。否决——在同一元素上混用 `transform` 与 Tailwind 的 `translate` 变量会重新引入"哪个属性在变"的歧义，正是本缺陷的成因。

### D2. 折叠区：折叠时不渲染子项 + grid 轨道动画

当前 `max-h-[1000px] opacity-0` 同时造成两个问题：硬上限裁剪，以及折叠后子项仍可聚焦。一个改动同时消除两者：折叠时直接不渲染子项。动画改用 `grid-template-rows: 0fr → 1fr` 的轨道过渡（子项容器 `overflow: hidden`），因为它在所有目标引擎可用，而 guide 推荐的 `interpolate-size` / `calc-size()` 是 Chrome/Edge 129+ 专属。

*备选*：保留渲染并设 `inert`。否决——`inert` 在旧 WebKit 上支持不全（且要额外分支），且 `max-height` 上限问题依然存在。可访问性与裁剪是两个缺陷，用"不渲染"一并解掉，代码量还更少。

*代价*：折叠/展开时子项被重新挂载（丢失滚动位置）。该分组内是短列表，可接受。

### D3. 系统主题监听提升到应用级，且事件时重读持久化设置

监听从 `useTheme()` 移到导出函数（应用挂载时订阅一次），因为 `useTheme()` 只在设置视图挂载。

关键点：handler 内不能用闭包里的 `theme`，否则用户从"跟随系统"改为"深色"后，监听仍会把界面改回系统配色。选择在事件触发时重读 `localStorage["theme"]`，因为那是权威持久化值，且避免了把 `useTheme` 的局部状态提升为全局状态。

*备选*：把主题状态提升到 Context/全局 store。否决——为修一个监听位置而引入全局状态层，超出最小改动的收益，且与"设置页局部状态 + 持久化为权威"的既有结构冲突。

### D4. 视图过渡内用 `flushSync` 提交主题

`startViewTransition` 的 callback 返回后浏览器才拍"新"快照；当前 callback 只 `setThemeState`，DOM 变更落在后续 effect，快照可能落在旧主题上。

改为在 callback 内 `flushSync` 提交，使 DOM 变更在 callback 返回前完成。保留 `document.startViewTransition` 存在性判断与原有非过渡分支。

*备选*：把 class 写入从 effect 移到 render 期。否决——React 渲染期写 DOM 是反模式，且会破坏严格模式下的可预期性。

### D5. `color-scheme` 双值，而非改 `applyTheme` 的解析逻辑

`:root` 改为 `color-scheme: light dark`；`applyTheme("system")` 写入 `"light dark"` 而不是解析后的单值。显式 light/dark 仍写单值。

理由：`color-scheme` 描述"本页能渲染哪些配色"，而不是"当前选中哪一个"；当前代码把它当成后者用，才会出现"深色画布 + 浅色原生控件"的错配。用双值表达能力、由 `.dark` class 表达选择，语义正交。

需要同步更新既有测试 `src/hooks/useTheme.test.ts`：它断言 `applyTheme("dark")` 后 `style.colorScheme === "dark"`，该断言不受影响；但若已有针对 `"system"` 的断言需改为 `"light dark"`。

### D6. 输入控件的焦点指示用"边框变色"，不画描边环

输入控件的既有视觉语言是"聚焦时边框变深"（`focus-visible:border-ring/50`）。问题不在形态而在强度：实测浅色 2.67:1、深色 1.69:1，低于 3:1。做法是把强度提到完整的 `--ring`（浅色 13.18:1、深色 5.09:1），保留形态。

*备选一*：照抄 `Button`/`Switch`/`Checkbox` 的 `focus-visible:ring-2 ring-ring ring-offset-2`。曾按此实现，后被否：浅色下 2px 近黑描边环在表单里视觉过重（用户实测反馈"之前没有黑框更好"），属于为对齐而牺牲观感；`Button` 那套本就是给行内小控件用的。

*备选二*：删掉 `outline-none` 让各引擎画默认焦点环。否决——macOS/GTK/Windows 三种 WebView 外观不一致，且与设计系统脱节。

*备选三*：`border-ring/60`（先按浅色对比度选的）。否决——深色的 `--ring` 本身是半透明的 `0 0% 100% / .5`，再乘 60% 后只剩 2.73:1，反而低于旧值。两处主题都取满值才同时达标。

### D7. IME 保护同时判 `isComposing` 与 `keyCode === 229`

guide 指出 WebKit（正是 WKWebView 与 WebKitGTK）在候选确认的 keydown 上 `isComposing` 已为 `false`，两处判断都要写。可测性：`keyCode === 229` 分支在 jsdom 中可直接构造，`isComposing` 需通过 `createEvent` 的 `composing: true` 或直接挂到 native event 上；测试至少覆盖 229 分支，并在 tasks 中标注 `isComposing` 分支为结构验证。

## Risks / Trade-offs

- [折叠时重新挂载子项会丢滚动位置] → 该分组为短列表，且当前实现本就每次折叠/展开重算高度；若将来变长列表，改回"保留渲染 + 折叠时 `inert`"。
- [`flushSync` 在过渡 callback 内同步刷新，理论上可能触发 React 警告（在渲染期调用）] → callback 由浏览器在事件之后调用，不在 React 渲染期；以测试断言 class 在 callback 内已变更来兜住。
- [应用级 matchMedia 监听与设置页 `useTheme` 的 `theme` 状态可能短暂不一致（设置页显示旧值）] → 该状态在设置页打开时由 localStorage 初始化且切换后立即写回，实际窗口极短；不在本 change 扩大范围去引入全局状态。
- [`color-scheme: light dark` 改变了"未应用脚本时"的原生控件外观] → 正是本 change 的目标；已有 `theme-init.js` 在 head 内阻塞执行，串行后仍先于绘制应用具体主题。
- [aria-label 使用技能名可能与页面其他同名文本重复，违反"避免重复名称"的可访问性建议] → 行复选框用 "Select {name}" 形式，含动作语义，降低歧义。

## Migration Plan

无数据迁移、无协议变更、无依赖变更。纯前端行为修复，回滚即 `git revert`。三步验证：`bun run test`（含新增回归测试）、`bun run typecheck`、`bun run lint` 与 `bun run format:check`。

## Open Questions

- macOS 侧 WebView 最低版本（`minimumSystemVersion` 未设）。本 change 的所有选择都避开了需要较新引擎的特性，因此不阻塞；但它会影响后续是否可采用 `content-visibility`、`scrollend`、`closedby` 等，建议在后续改动前定下来。
