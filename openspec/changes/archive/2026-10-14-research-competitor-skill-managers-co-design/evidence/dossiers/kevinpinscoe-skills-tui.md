# kevinpinscoe/skills-tui(★0|Go(bubbletea)|2026-10-04|MIT)

## 1. 定位与架构(实证)

一句话定位:技能**启动器**而非管理器。它在终端里做两级选择(分类→技能),确认后要么执行技能目录里的 run.sh,要么把 SKILL.md 正文当 prompt 拉起 `claude`。

技术栈:Go + charmbracelet bubbletea/lipgloss,全部逻辑在单文件 `main.go`(554 行),无状态存储、无安装/同步/卸载,磁盘零写入。

SSOT/分发模型:无。只读扫描一个目录(`~/.claude/skills`,可用 SKILLS_DIR 覆盖,`main.go:428-433`),平铺一层;技能身份=目录名。分类是**合成的**,因为它读每个 SKILL.md frontmatter 的 `category:` 字段聚合,不是目录结构,缺省落 "uncategorized"(`main.go:226-249, 312-320`)。

形态:TUI。技能来源:仅本地目录。

## 2. 功能清单

- 两级选择器(分类→技能,/ 过滤,Esc 返回)[完整] `main.go:85-155`
- 执行:run.sh 优先,以技能目录为 cwd、stdin 直通地 `bash run.sh`;否则 `claude "<去 frontmatter 的 SKILL.md 全文>"` 作为初始 prompt(`main.go:528-545`)。执行前 y/N 确认(`main.go:520-526`)[完整]
- .gitignore 排除:手写 glob(不支持否定),把装进同目录的第三方内容挡在列表外("不管理不属于你的东西")[完整] `main.go:322-355`
- symlink 感知:目录项是 symlink 时 stat 跟随判断(`main.go:357-369`)[完整]
- 排序 alpha/mtime/recent + `--list` 纯文本清单 [完整] `main.go:381-415`
- 发布工程:cosign 签名 + SPDX SBOM + ad-hoc codesign + checksums/commit 钉扎 [完整](对一个 554 行工具来说过度,但卫生是真卫生)
- 管理能力(安装/启停/更新/多 agent):**没有**,也不打算有。

## 3. 借鉴候选(90 分门槛)

无。评估任务点名的"应用内一键试运行技能":

- 它的做法 = 把 SKILL.md 全文塞给 `claude` 当 prompt + 可选执行任意 run.sh。在 TUI 里这是合理的:终端透明、y/N 显式、用户对"我在跑别人的脚本"有清醒预期。
- 移到 skill-zoo 桌面端则两头不讨好:(a) 试运行 SKILL.md-as-prompt 是旁路技能系统的 hack,桌面端自然形态是"在终端里打开并输入 /skill",一行命令的成本;(b) 一键执行 run.sh 是把任意第三方脚本执行藏进 GUI 点击背后,安全语义比 TUI 明示确认更差;(c) 交互式 TUI(claude REPL)进 Tauri 需要 PTY + 内嵌终端(xterm.js),代价远超收益。chops 的 ComposePanel 已覆盖其中真正有价值的部分("调用用户已装的 agent CLI"),且用在了更高价值的场景(编写+diff 审阅)。

## 4. 明确不借鉴(带理由)

- run.sh 一键执行:GUI 里藏任意脚本执行,安全倒退;桌面端"试运行"应落在"打开终端"而非代跑。
- claude-as-prompt 启动:绕过技能发现机制的一次性 prompt hack,不是"运行技能"。
- category frontmatter 合成分类:单一字段的伪分类体系,skill-zoo 的 collections/tags 语义更完整。
- .gitignore 排除第三方内容:思路优雅("不管理不属于自己的")但 skill-zoo 的 origin 模型(remote/agent/external)已是更强的所有权语义。
- 全部发布工程:与技能管理领域无关。
- 管理功能:不存在,无从借鉴。

## 5. 借鉴裁定

NOTHING: 它是 554 行的启动器,不是管理器。"在 GUI 里代跑技能/脚本"这个核心交互在桌面端是安全与架构双输,而它唯一沾边的有价值想法(用用户已装的 agent CLI 驱动技能)已被 chops 的 ComposePanel 以更完整的形态覆盖(见 Shpigford-chops.md §3.1)。
