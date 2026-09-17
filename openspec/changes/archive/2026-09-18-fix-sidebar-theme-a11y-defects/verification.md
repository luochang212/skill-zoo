# Verification: fix-sidebar-theme-a11y-defects

本文件是该 change 的复核证据留痕（worth-fix 流程）。所有结论都标注了判定等级与复现方式；未实测的部分明确标注为结构验证，不以审查充实证。

来源：对 `modern-web-guidance` 指南（143 篇）的系统扫描产物做二次复核。该扫描的完整叙述报告位于本地暂存目录 `archived/`（被 `.gitignore` 忽略，不入库），本文件是其中与本次修复相关部分的**自包含**版本。

## 复核方法

- **桌面端动画与布局**：用真实 Chrome（headless）+ 仓库真实构建产物 `dist/assets/*.css`，给元素套用生产代码里的**原样 class 字符串**，监听真实 transition 事件；另用仓库自带的 `@tailwindcss/postcss@4.3.2` 从 `/tmp` 重新构建以交叉印证。
- **可访问性树**：用真实 Chrome 的 CDP `Accessibility.getFullAXTree`，而非仅看 DOM 属性。
- **行为回归**：vitest + jsdom 渲染**真实组件**（复用既有测试的 mock harness），不断言模拟实现。
- 未启动完整 `<SkillContentPane>` 的端到端渲染（需要 Tauri IPC 数据，纯浏览器不可达），该断言由 class 契约测试与浏览器实测共同覆盖。

## 逐条判定

### 1. 侧栏滑入动画失效 — 坐实，且原判**低估** → 已修

- 编译事实（真实 `dist` 产物）：`.-translate-x-full{--tw-translate-x:-100%;translate:var(--tw-translate-x) var(--tw-translate-y)}`，而 `.transition-\[transform\,opacity\]{transition-property:transform,opacity}`（不含 translate）；对照 `.transition-transform{transition-property:transform,translate,scale,rotate}`（含）。
- 浏览器实测：切换 `-translate-x-full opacity-0` → `translate-x-0 opacity-100`，只触发 `run:opacity` / `start:opacity`，无 translate / transform 事件；t=100ms（200ms 过渡）时 `translate` 已为 `0px`，而 `opacity` 仍在 `0.4419`。对照组改用 `transition-transform` 后 t=100ms 为 `translate: -55.8089%`，证明该属性可动画。
- **低估之处**：外层容器（原 `:510-514`）的 `width` 为内联值且**无过渡**，折叠时同帧归零；t=100ms 时 `outerWidth=0px`，`elementFromPoint(100,150)` 已返回主面板。因此折叠方向连淡出都不可见——原报告只描述了"只淡入不位移"。
- 结论：修复必须同时覆盖内层 translate 与外层 width（后者是本 change 新增的部分）。

### 2. 折叠区可聚焦 + 1000px 裁剪 — 坐实，影响有边界 → 已修

- 折叠后容器为 `overflow-hidden ... max-h-0 opacity-0`，仓库按钮仍在 DOM：`display: block`、`aria-hidden` 为 null、`inert` 为 false。
- 真实 Chrome AX 树：`Owner/Repo` 与 `Unassigned` 仍为 `role=button, ignored=false`；`repoBtn.tabIndex === 0`，`repoBtn.focus()` 后 `document.activeElement === repoBtn`。即引擎知道它不可见（`checkVisibility({opacityProperty:true})` 返回 false），却仍暴露且可聚焦。
- 边界：默认 `useState(true)` 为展开态，需用户先手动折叠；危害是键盘/读屏可达性，不是鼠标路径 bug。
- 裁剪：`max-h-[1000px]` 为任意上限，超出即静默截断。

### 3. 共享 Input 焦点指示 — **部分属实**（数字经修正）→ 已修

- 类名属实：`focus-visible:outline-none focus-visible:border-ring/50`，无 `focus-visible:ring`；编译产物为 `border-color: color-mix(in srgb, hsl(var(--ring)) 50%, transparent)`。
- 对比度实测（按 `src/index.css` 真实 token 计算）：
  - 原值 `border-ring/50`：浅色 **2.67:1**（原报告"约 2.7:1"正确）、深色 **1.69:1** —— 后者**低于 WCAG 1.4.11 的 3:1**，原文未给深色数字。
  - 修复后 `focus-visible:border-ring`：浅色 **13.18:1**、深色 **5.09:1**。
- 中途曾改为与 `Button`/`Switch`/`Checkbox` 一致的 `ring-2` 描边环（用户实测认为视觉过重，观感回退），已撤回；取舍见 `design.md` D6。
- 同类写法实为**三处**（非两处）：`ui/input.tsx`、`InstalledSkills` 搜索框、`SkillCompanionSettings.tsx:594` 的说明文本框。

### 4. 中文输入法 Enter — 坐实，影响**夸大** → 已修

- 真实组件复现：对搜索框触发 `fireEvent.keyDown(input, { key: "Enter", isComposing: true })`（`@testing-library/dom@10.4.1` 经 `new KeyboardEvent(type, eventInit)` 构造，`isComposing` 由 jsdom 原生设置），观测到 `onSelectRepo` 仍被调用并完成导航；对照 `isComposing: false` 亦导航，证明分支确实执行。
- `src/` 全树 grep 无任何 `isComposing` / `compositionstart`。
- **夸大之处**：触发需同时满足"repo 形状的 debouncedSearch + 下拉打开 + repoResult 已返回 + 按 Enter 确认候选"，原报告若读作"中文打字就跳走"不成立。
- 引擎要点：guide 引 WebKit bug 165004 —— 候选确认时 WebKit 报 `isComposing === false`，故 `keyCode === 229` 是 WKWebView / WebKitGTK 上真正生效的判断，两者都需保留。

### 5. 系统主题只在设置页生效 — 坐实 → 已修

- `useTheme` 仅被 `ThemeSettings.tsx:5,18` 引用；`applyTheme` 调用点仅 `useTheme.ts:32,40` 与 `App.tsx:131`；`src/` 无其他 `matchMedia`。
- `App.tsx:129-132` 仅在挂载时应用一次且**不注册监听**；`SettingsView` 仅在 `view === "settings"` 时渲染，故 hook 与监听在任何其他视图卸载。
- hook 生命周期探针：挂载消费者 → 1 个监听，OS 翻转生效；卸载 → 0 个监听，再翻转文档保持旧主题。
- 边界：陈旧状态在重开设置或重启后自愈。

### 6. 主题切换落在视图快照之后 — 坐实 → 已修

`startViewTransition` 回调内只排一次 React 状态更新，class 与 `color-scheme` 在后续 effect 才写入；浏览器在回调返回后立即拍"新"快照，故可能捕获旧主题。`same-document-transitions` 要求 DOM 更新发生在回调内。修复用 `flushSync` 提交，并以测试断言"回调返回时 class 已变更"。

### 7. `color-scheme` 钉死 light — 坐实 → 已修

`:root` 原为 `color-scheme: light`；`applyTheme("system")` 写入解析后的单值。改为双值后，跟随系统时原生控件/滚动条由 OS 决定，显式选择仍钉单值，与既有 `.dark` class 正交。

## 未纳入本次修复

| 条目 | 状态 | 原因 |
|---|---|---|
| markdown 每键重解析（`SkillContentPane`）、搜索逐键全量过滤（`InstalledSkills`）、卡片网格 `content-visibility` | 未修 | 需要运行时性能打点（profiling）才能判定收益，本 change 不含实测数据，不应凭代码推断宣称改善 |
| `AboutSection.tsx:51` 的 116KB logo 立即加载 | 未修 | 真实运行应用中确认 40×40 / `naturalSize 256×256` / `complete: true`，位于 484px 高滚动视口下方 1168px；但 Tauri 中为本地打包资源而非网络下载，实际成本是磁盘读 + 解码，且仅打开设置时发生。影响**夸大**，与性能类一并延后 |
| CLI WUI 手搓模态改原生 `<dialog>`、toast 覆盖与层级 | 未修 | 另一个界面、另一套运行时（真实浏览器）；改造需重写 toast 定位与降级路径，独立立项 |
| `Header` 当前项 `aria-current`、视图切换按钮可访问名称、`html lang` 随语言同步、`SkillCreateView` 的 label 关联与校验时机、Banner 轮播卡片键盘可达 | 未修 | 同类缺陷但未纳入本次范围，已在扫描报告中逐条标注 |
| guide 建议中在本项目属回退者（`overlay` 过渡、`dialog closedby`、`Temporal`、`overflow: clip`、`scrollend`） | 不修 | 在系统钉死版本的 WebView 上会失效或需额外降级代码，理由见扫描报告 |

## 验证边界（如实声明）

- 未启动完整应用做人工键盘遍历或 axe 扫描；跨引擎兼容性陈述来自 guide 的 Baseline 表 + 静态阅读依赖，未在 WKWebView / WebKitGTK / WebView2 三端实测。
- 深色主题下 `--ring` 为半透明白（`0 0% 100% / .5`），对比度为按 token 的算术推导，非引擎渲染取色。
- 桌面端动画结论来自真实 Chrome（Blink）；WKWebView / WebKitGTK 上的具体表现未实测，但所用特性（`transition-property: translate`、`grid-template-rows: 0fr→1fr`）均在各端长期可用。
- `tauri.conf.json` 未设 `minimumSystemVersion`，macOS 侧 WebView 下限未知；本次所有实现选择都避开了需要较新引擎的特性，故不阻塞。
