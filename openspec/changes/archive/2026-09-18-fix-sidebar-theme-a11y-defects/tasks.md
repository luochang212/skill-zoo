## 1. 回归测试（先红）

- [x] 1.1 在 `src/components/skills/SkillSidebar.test.tsx` 增加：折叠仓库分组后，仓库按钮不再出现于文档（`queryByRole("button", { name: "Owner/Repo" })` 为 null），且开关 `aria-expanded` 为 `"false"`；展开后按钮恢复且 `aria-expanded` 为 `"true"`。验证：先跑该测试确认在当前实现下失败（红）。
- [x] 1.2 新建 `src/components/skills/SkillContentPane.test.tsx`：断言侧栏内层元素的 class 包含 `transition-[translate,opacity]` 与 `translate-x-0`/`-translate-x-full` 的成对关系（即过渡属性覆盖实际位移属性）。验证：先跑确认在当前实现下失败（红）。同时把已核实的事实（`dist/assets/*.css` 中 `-translate-x-full` 编译为 `translate:` 属性）作为该测试存在的理由写进注释。
- [x] 1.3 在 `src/hooks/useTheme.test.ts` 增加：导出函数订阅 `matchMedia` change 后，在 `localStorage.theme === "system"` 时触发事件会应用系统配色；在 `localStorage.theme === "dark"` 时触发事件不改变当前配色。验证：先跑确认当前无该导出函数时失败（红）。
- [x] 1.4 在 `src/hooks/useTheme.test.ts` 增加：`applyTheme("system")` 后 `documentElement.style.colorScheme` 为 `"light dark"`；`applyTheme("dark")`/`applyTheme("light")` 仍为单值。验证：先跑确认 `"system"` 断言失败（红）。
- [x] 1.5 在 `src/hooks/useTheme.test.ts` 增加：mock `document.startViewTransition`，断言传入的 callback 返回时 `documentElement` 已带上新主题 class（用 `flushSync` 前后行为差异证明）。验证：先跑确认当前失败（红）。
- [x] 1.6 在 `src/components/skills/BrowseSkills.test.tsx` 增加：在仓库搜索结果存在且下拉打开时，对搜索框触发 `keyDown`（`key: "Enter"`, `keyCode: 229`），断言未发生仓库导航；再以普通 Enter 断言导航正常发生。验证：先跑确认 229 分支失败（红）。

## 2. 侧栏折叠区与展开状态

- [x] 2.1 `src/components/skills/SkillSidebar.tsx`：折叠时不再渲染分组子项，动画改为 `grid-template-rows` 0fr→1fr 轨道过渡（子项容器 `overflow: hidden`），删除 `max-h-[1000px]`/`max-h-0`/`opacity-0` 方案；给开关补 `aria-expanded={reposExpanded}`。验证：1.1 转绿。
- [x] 2.2 `src/components/skills/SkillFileTree.tsx`：目录按钮补 `aria-expanded={node.isDir ? expanded : undefined}`（文件条目不输出该属性）。验证：在 `SkillSidebar.test.tsx` 或文件树相关测试中断言目录按钮的 `aria-expanded` 随展开切换，且文件条目无该属性。
- [x] 2.3 人工确认折叠区在条目很多时不再裁剪：构造超过一屏的仓库数量渲染，断言全部条目可查询到。验证：该断言随 1.1 的测试一并保留。

## 3. 位移动画

- [x] 3.1 `src/components/skills/SkillContentPane.tsx`：把 `transition-[transform,opacity]` 改为 `transition-[translate,opacity]`，`willChange` 由 `"transform, opacity"` 改为 `"translate, opacity"`。验证：1.2 转绿；`bun run test` 全套无回归。

## 4. 主题跟随系统与原生配色

- [x] 4.1 `src/hooks/useTheme.ts`：新增并导出应用级系统主题订阅函数（挂载时调用一次，返回取消订阅函数）；handler 在触发时重读 `localStorage["theme"]`，仅当为 `"system"` 时 `applyTheme("system")`。
- [x] 4.2 `src/App.tsx`：在既有挂载 effect 中调用该订阅函数，并在卸载时取消订阅。验证：1.3 转绿；grep 确认 `applyTheme` 的调用点仍只有 `App.tsx` 与 `useTheme.ts`。
- [x] 4.3 `src/hooks/useTheme.ts`：`startViewTransition` 的 callback 内用 `flushSync` 提交主题状态，保留非过渡分支。验证：1.5 转绿。
- [x] 4.4 `src/index.css`：`:root` 的 `color-scheme` 改为 `light dark`；`applyTheme` 在 `theme === "system"` 时写入 `"light dark"`。验证：1.4 转绿；既有 `applyTheme("dark")`/`applyTheme("light")` 断言仍通过。

## 5. 焦点可见性与可访问名称

- [x] 5.1 `src/components/ui/input.tsx`：保留『边框变色』形态，把 `focus-visible:border-ring/50` 提到 `focus-visible:border-ring`（浅色 13.18:1 / 深色 5.09:1，均过 3:1）。**中途曾改为 `ring-2` 描边环，依用户实测反馈（『之前没有黑框更好』）回退**，理由记入 design D6。验证：`ui/input.test.tsx` 断言含 `focus-visible:border-ring`、不含 `/50`、不含 `focus-visible:ring-2`；`bun run test` 无回归。
- [x] 5.2 `src/components/skills/InstalledSkills.tsx`：搜索框同 5.1 处理并补 `aria-label`（复用既有 i18n key `installed.searchPlaceholder`）。验证：断言搜索框的 `aria-label` 存在且焦点 class 含 `focus-visible:border-ring`。
- [x] 5.3 `src/components/settings/SkillCompanionSettings.tsx:594` 的说明文本框：按 5.1 对齐为 `focus-visible:border-ring`，并补 `aria-invalid` / `aria-describedby`。验证：断言该 textarea 的焦点 class 含 `focus-visible:border-ring`。
- [x] 5.4 `src/components/skills/SkillCardRow.tsx` 与 `src/components/skills/InstalledSkills.tsx`：行选择复选框补 `aria-label={\`Select ${skill.name}\`}` 形式，全选复选框补说明全选语义的名称。验证：断言两者的可访问名称存在且非空。

## 6. 输入法安全

- [x] 6.1 `src/components/skills/BrowseSkills.tsx`：Enter 分支前增加 `if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;`。验证：1.6 转绿。
- [x] 6.2 记录验证边界：`isComposing` 分支在 jsdom 下不易构造（React 合成事件），标注为结构验证；`keyCode === 229` 分支为实测。

## 7. 收口

- [x] 7.1 `bun run test` 全套通过（含 1.x 新增测试），记录通过/失败数（实际：`bun run test` 27 files / 154 tests 全绿；首轮在并行负载下有 5 个 5s 超时，单独重跑全绿，判定为负载抖动而非回归）。
- [x] 7.2 `bun run typecheck`、`bun run lint`（0 warnings / 0 errors）、`bun run format:check`（106 files）均干净。
- [x] 7.3 复核证据留痕到 change 内（`verification.md`）：逐条给出判定等级（坐实 / 部分属实 / 证伪）、复现方式与实测数字，并列出未纳入本次修复的条目及原因。**不指向 `archived/`**——该目录被 `.gitignore` 忽略，引用它对克隆者会是死链。
- [x] 7.4 `openspec validate fix-sidebar-theme-a11y-defects --strict` 通过。
