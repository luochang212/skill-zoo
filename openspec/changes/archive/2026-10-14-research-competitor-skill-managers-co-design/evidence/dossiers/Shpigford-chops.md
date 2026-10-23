# Shpigford/chops(★1947|Swift/SwiftUI|2026-08-23|FSL-1.1-MIT)

## 1. 定位与架构(实证)

一句话定位:macOS 原生的 coding agent 技能/agent/rule 管理器。它做发现、组织、编辑,零 WebView。

技术栈:SwiftUI + SwiftData + Sparkle(唯一外部依赖);无沙箱(entitlements 显式禁用,README"Architecture"节);无测试套件(README 明言手动验证)。

SSOT/分发模型:与 skill-zoo 几乎同构。`~/.agents/skills/` 为 canonical store(Registry install: `SkillRegistry.swift:277-286` 注释"Canonical location — matches the official skills CLI behavior"),agent 目录只放 symlink(`SkillRegistry.swift:300`);去重以 resolved symlink path 为身份(`SkillScanner.swift:314-348` canonicalResolvedPath),同文件多目录安装合并为一个实体、多个 tool badge(`SkillScanner.swift:488-511` installedPaths/toolSources)。缓存=SwiftData,文件系统是真相:扫描后删除磁盘上已消失的条目(`SkillScanner.swift:533-535, 656-664`)。注意一处关键差异:chops 的 makeGlobal 会**移动**项目级技能目录进 SSOT 并在原位留 symlink(`Skill.swift:196-251`),这违背 skill-zoo"本地技能绝不移动"的决策。

形态:桌面 app(DMG,菜单栏无);技能来源:本地多工具目录扫描 + skills.sh 注册表搜索/热门 + SSH 远程服务器(OpenClaw/Hermes 布局)。

## 2. 功能清单

- 多工具目录扫描(Claude/Cursor/Codex/Windsurf/Amp/Copilot/Aider/OpenCode/Hermes + Claude 插件缓存 + 自定义路径)[完整] `SkillScanner.swift:51-131`
- symlink 感知去重与多目标安装视图 [完整] `SkillScanner.swift:481-531`
- skills.sh 搜索(官方 JSON API)[完整] + 热门榜(爬取 HTML 内 RSC payload,session 缓存),后者为半成品,原因是爬虫脆弱(`SkillRegistry.swift:69-111`)
- 注册表安装:只取 SKILL.md 单文件内容写入 SSOT 并 symlink 各 agent [半成品] `SkillRegistry.swift:263-307`,它**不支持多文件技能**(scripts/、references/ 全丢),路径探测靠约定+tree API 兜底
- 项目级技能"提升为全局":移动进 SSOT + 原位留 symlink + 全 agent 链接 [完整] `Skill.swift:196-251`(实现好但与 skill-zoo 决策冲突)
- agent 安装检测:evidencePaths(工具自己的配置文件)+ /Applications bundle + PATH/nvm 二进制探测 [完整] `AgentTarget.swift:19-60, 70-181`
- 文件监听:DispatchSource fd 监听 + 0.5s debounce 触发全量重扫 [完整] `FileWatcher.swift:23-61`(README 说 FSEvents,实为 DispatchSource,实现与声明不符但可用)
- 全文搜索:内存中对全部 SwiftData 实体做 substring 过滤 [摆设] `SearchService.swift:5-18`,其实现是全表加载线性扫,千级技能即卡
- Collections:SwiftData 侧分组、拖拽归组,**不动文件** [完整但浅] `CollectionListView.swift:83-91`
- 内置编辑器:NSTextView 封装、语法高亮、Cmd+S 写盘 [完整] `SkillEditorView.swift`(376 行)
- **AI 辅助编写(ComposePanel)**:调用用户已装的 `claude --print`/`codex exec` 一次性生成/修改 SKILL.md,禁用 agent 工具(`ClaudeCLIAgent.swift:231` `--tools ""`),结构化 edits JSON 或围栏全文两种协议解析(`OneShotResponseParser.swift:25-60`),LCS diff 审阅后应用(`DiffReviewPanel.swift:44-50`,ComposePanel.swift 共 1153 行,含权限请求、pendingWrites、活动流)[完整,全仓库完成度最高的模块]
- SSH 远程技能浏览(`SSHService.swift` 196 行)[半成品]
- enable/disable 单技能:**没有**。Collections 是纯数据库分组,不碰文件系统;无任何 per-skill 停用机制(grep 全仓无 disable 实现)。

macOS 原生 vs Tauri:chops 的原生优势在**体验层**(NSTextView 编辑器、三栏 NavigationSplitView、系统字体/动效),不在能力层。它做的每件事(扫目录、写 symlink、spawn CLI)Tauri+Rust 都能做。没有 Tauri 做不到的 load-bearing 能力。

## 3. 借鉴候选(90 分门槛)

### 3.1 ComposePanel:用用户已装的 agent CLI 辅助编写/修改 SKILL.md
- 是什么:编辑器内联面板,把"改这个技能"交给用户自己安装的 claude/codex 一次性执行,产出 diff,人工审阅后落盘。
- 程度:1153 行 + 独立响应协议层(结构化 find/replace edits JSON,失败回退围栏全文)+ LCS diff 引擎 + 权限/活动流/调试日志。协议设计聪明:显式禁用工具(`--tools ""`)使 agent 只能回文本,杜绝直接写盘绕过审阅。
- 为什么 great:三个同类里唯一做到"AI 参与编写且人类有最终否决权"的闭环;复用用户已有 agent 鉴权,零 API key 管理。
- 落点:Rust 侧新增 spawn agent CLI 的 Tauri command(流式 stdout 转发到前端;skill-zoo 已有 CliService 先例,进程管理有现成模式),前端一个 diff 审阅组件。成本中等(1-2 周)。与架构无冲突:最终写盘仍走 Tauri 命令、写文件系统,agent 只产文本。注意:chops 用 `--print` 一次性调用而非常驻会话,这个收敛值得原样抄。

## 4. 明确不借鉴(带理由)

- 只装 SKILL.md 单文件的安装器:功能残缺,multi-file 技能直接坏;skill-zoo 的 ZIP 全量解压是对的。
- makeGlobal 移动目录进 SSOT:违背 skill-zoo"本地技能绝不移动/复制"的核心决策;且在用户项目目录里留 symlink 是越权写。
- skills.sh 热门榜 HTML 爬虫:RSC payload 正则提取,上游一改就碎;skill-zoo 已有正规 discovery。
- 内存全量 substring 搜索:伪全文搜索,O(n) 全表加载;不如现有索引方案。
- Collections 纯数据库分组:不落文件系统=第二真相源,恰是 skill-zoo 反对的;且无 enable/disable 语义。
- SSH 远程服务器:超出本地优先产品边界,SSH 管理面是另一个产品。
- agent evidencePaths 检测:思路可取(用工具自身配置文件判断安装,而非探测 skills 目录)但实现平凡,作为细节并入现有 Settings 逻辑即可,不值单独一格。

## 5. 借鉴裁定

ABSORB: ComposePanel 模式(用户已装 agent CLI 一次性生成/修改 SKILL.md + 禁用工具 + 结构化 edits 协议 + diff 人工审阅落盘);次要从宽:agent 检测改用 evidencePaths。
