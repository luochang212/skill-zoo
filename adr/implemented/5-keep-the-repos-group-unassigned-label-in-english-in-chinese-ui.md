---
status: implemented
date: 2026-10-31
description: 在翻译 src/i18n 下任何内容，或改动本地页侧边栏 repos 分组之前阅读；其中一个标签在任何界面语言下都刻意保持英文。
raised-by: human
decided-by: human
created: 2026-10-31
commit: 596f5c8
paths:
  - src/i18n/zh.json
  - src/i18n/en.json
  - src/components/skills/SkillSidebar.tsx
---

# ADR: 5 中文界面下 repos 分组的 unassigned 行保持英文

## Problem

本地化只有一条规则：用户可见文案跟随界面语言，`zh.json` 与 `en.json` 逐键镜像，中文值缺失时回退英文（`src/i18n/index.ts` 的 `fallbackLng: "en"`）。统一套用这条规则，恰好在一个地方产生错误结果。

本地页侧边栏的 repos 分组列出的是 GitHub 仓库标识：`owner/name` 这类用户数据，按 GitHub 的写法呈现，从不翻译。该分组最后一行不是仓库，而是「装在任何仓库之外的 skill」的哨兵值（`category` 类型 `unassigned`）。它可见的邻居全是英文标识，于是翻译后的 `未分类` 落在一列英文数据里：CJK 字形打断这一列的扫读节奏，让这一行读起来像界面外壳，而不是这个列表的一员。这个列表只有一条比较轴，这个标签把它破坏了。

agent 会反复把这个值当成未完成的翻译去补完。最近一次以 `"unassigned": "未分类"` 的形式在 `8d147f8`（"localize feedback"）落地；维护者不得不手工回退这一类改动。代码里没有任何东西表明这个英文值是有意的，所以每一次只读文件的审计都会得出同一个错误结论。

## Decision

- `sidebar.unassigned` 在任何界面语言下都渲染 `Unassigned`。英文在这里是正确值，不是缺失值。
- `zh.json` 保留一个与英文值相同的显式键，而不是删掉该键：缺失条目与疏漏无法区分，恰好招来这条记录所禁止的翻译；而写入相同的显式值能让 bundle 保持完整镜像，键位一致性检查才有意义。
- 例外的划定依据是这一行的邻居，而非它自身的内容：一个标签，只要其可见邻居是仓库标识，就保持英文。它不在任何别处授权英文。仓库表头本身、计数、空状态、tooltip，以及其他所有字符串，都跟随界面语言。放进这个仓库列表的新行适用同一判据；针对列表本身的标签则要翻译。
- 这是应用唯一一处有意的例外。出现第二个要另立记录，而不是把这条规则读宽。

## Alternatives considered

- **翻译它 —— 把规则当绝对。** 否决：这正是反复回来的那个状态。规则存在的目的是让用户看懂界面，而在一列英文标识里塞一个中文词，恰恰是遵守规则反而降低理解的那一处。每次出现都被回退过。
- **删掉 `zh` 键，让 `fallbackLng` 渲染英文。** 否决：文件里就不再有任何信号表明「缺失是有意的」。意图只存在于代码之外，而对比键集的审计者会看到一个洞。
- **在 `SkillSidebar` 里硬编码 `Unassigned` 并停止调用 `t()`。** 否决：它把有意为之的文案藏出翻译层，而在翻译层至少还能与同族键并列可见；这是用 JSX 里一个静默的特殊情况，替换掉一条有文档的例外。
- **把仓库标识也本地化，例如 `未分配仓库`，让分组统一为中文。** 否决：`owner/name` 来自 GitHub。为迎合界面语言去改写用户数据，比留一个英文标签更糟，而且会破坏侧边栏与仓库页面之间的对应关系。

## Consequences

中文界面里会有一行英文，而这正是预期的读法：这个分组是一列仓库标识，其中一条表示「没有仓库」。代价是将来任何键位一致性或未翻译值审计都会把 `sidebar.unassigned` 标为可疑。这条记录就是这个标记的答案；改掉那个字符串才是 bug。保留显式值让标记保持显眼、可复核，而不是留下一个看不见的洞。

### Verification

`src/i18n/zh.json` 中为 `"unassigned": "Unassigned"`，`src/components/skills/SkillSidebar.tsx` 在 repos 列表末尾通过唯一的 `t("sidebar.unassigned")` 调用点渲染它。`adrkit validate --all` 通过。本条取代的错误状态是 `8d147f8`。
