## Why

`modern-web-guidance` 扫描（复核证据与判定见 `verification.md`）在桌面端选中 4 类问题，其中 3 类是**行为缺陷而非风格偏好**：侧栏滑入动画因属性不匹配而完全失效、仓库列表被硬上限静默裁剪且折叠后仍可 Tab 到隐形按钮、系统主题变化只在设置视图挂载时生效。另有共享输入控件的焦点环被抹掉、折叠控件不暴露展开状态、中文输入法回车会直接跳走。

这些都不是"照 guide 抄"，而是每一条都能用现有测试基础设施（vitest + jsdom + 真实组件，`src/components/**/*.test.tsx`）写成红→绿回归测试的缺陷。集中在一个 change 里修，是因为它们同属"桌面 UI 的交互与可达性契约"，且都落在 `src/` 前端一处，不需要动协议、Rust 或 CLI。

## What Changes

- **侧栏滑入动画失效**：`SkillContentPane` 的文件树侧栏用 `transition-[transform,opacity]` 配 `-translate-x-full`，而 Tailwind v4 把位移编译为独立属性 `translate:`。改为过渡 `translate`，并同步 `willChange`。
- **仓库列表被裁剪**：`SkillSidebar` 的折叠区用 `max-h-[1000px]` 动画，超过上限的仓库被静默裁掉；折叠态用 `max-h-0 opacity-0` 隐藏，按钮仍留在 Tab 序列与无障碍树中。改为 grid 轨道（`0fr → 1fr`）动画并在折叠时不渲染子项，同时给开关补 `aria-expanded`。
- **系统主题不跟随 OS**：`matchMedia` 监听只存在于 `useTheme()`，而该 hook 仅被设置页的 `ThemeSettings` 调用。把监听提升到应用级挂载，并在事件触发时重新读取当前主题设置，避免覆盖用户的显式选择。
- **主题切换的快照顺序**：`startViewTransition` 回调内只排了一次 React 状态更新，主题 class 落在后续 effect 里，新快照可能仍在旧主题下拍摄。改为在回调内同步提交 DOM。
- **`color-scheme` 默认钉死单值**：`:root { color-scheme: light }` 与"跟随系统"语义矛盾，JS 路径失败时会出现深色画布配浅色原生控件。改为 `light dark`，并在主题为 `system` 时写入双值。
- **焦点可见性**：共享 `Input` 用 `focus-visible:outline-none` 抹掉焦点环，替代物只有 1px/50% alpha 的边框色——实测对比度浅色 **2.67:1**、深色 **1.69:1**（后者低于 WCAG 1.4.11 的 3:1）。改为与 `Button`/`Switch`/`Checkbox` 一致的 `ring-2`。同类写法共三处：`ui/input.tsx`、`InstalledSkills` 搜索框、`SkillCompanionSettings` 的说明文本框，一并处理并补 `aria-label`。
- **可访问名称与展开状态**：行选择与全选复选框补 `aria-label`；文件树目录按钮补 `aria-expanded`。
- **输入法安全**：`BrowseSkills` 的仓库搜索在 Enter 分支无合成态保护，中文用户确认候选词即触发跳转。补 `isComposing || keyCode === 229` 双判。

## Capabilities

### New Capabilities

- `desktop-ui`: Tauri 桌面界面（`src/`）的交互与可达性契约——折叠/展开控件必须暴露状态且不得留下不可见可聚焦内容、动画必须真正作用于被改变的属性、主题必须能跟随系统且不出现错误的原生配色、共享表单控件必须提供可见焦点指示与可访问名称、键盘提交必须对输入法合成安全。

### Modified Capabilities

（无。现有 `ssot-scan` / `skill-installation` / `skill-archiving` / `skill-file-queries` / `repo-zip-download` 均不涉及前端交互契约。）

## Impact

- 代码（全部在 `src/`，无协议、无 Rust、无 CLI 改动）：
  - `src/components/skills/SkillContentPane.tsx`（过渡属性 + `willChange`）
  - `src/components/skills/SkillSidebar.tsx`（grid 轨道动画、折叠时不渲染、`aria-expanded`）
  - `src/components/skills/SkillFileTree.tsx`（`aria-expanded`）
  - `src/components/skills/SkillCardRow.tsx`、`src/components/skills/InstalledSkills.tsx`（复选框名称、搜索框焦点环与名称）
  - `src/components/ui/input.tsx`（焦点环与既有 primitive 对齐）
  - `src/components/skills/BrowseSkills.tsx`（IME 保护）
  - `src/hooks/useTheme.ts`（应用级系统主题监听、`color-scheme` 双值、`flushSync` 提交）
  - `src/App.tsx`（挂载时订阅系统主题）
  - `src/index.css`（`:root` 的 `color-scheme`）
- 测试：新增/扩展 `src/components/skills/SkillSidebar.test.tsx`、`SkillContentPane`（新建）、`BrowseSkills.test.tsx`、`src/hooks/useTheme.test.ts`，作为回归护栏。
- 验证边界（如实记录）：本次未包含需要运行时性能打点或真实浏览器评测的条目（markdown 重解析、搜索逐键过滤、卡片虚拟化、CLI WUI 的 `<dialog>` 改造），它们列在 `verification.md` 的"未纳入本次修复"一节，另行立项。
- 不引入任何新依赖，不升级依赖。
