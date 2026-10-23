# wujiyu115/skm(★0|Go|2026-07-17|无 license)

## 1. 定位与架构(实证)

一句话定位:单 Go 二进制 = Cobra CLI + go:embed 内嵌 React Web UI 的技能库管理器,中央库 + SQLite 元数据 + symlink 分发。

技术栈:Go(gofiber + go-git + cobra + SQLite)+ React/Vite(web/,`go:embed all:dist` 编译进二进制,`internal/server/embed.go:5-6`);`skm serve -p 3721 --open` 起本地服务开浏览器(`internal/cli/serve.go:23-70`),--debug 模式旁路启动 Vite 热更。

SSOT/分发模型:与 skill-zoo 同构。`~/.skm/skills/` 为中央库(`internal/cli/config.go:31-38`),安装=git 浅克隆(depth=1, go-git 纯 Go 实现,`internal/fetcher/git.go:17-44`)→ **全目录复制**进中央库 → 各 agent 目录 symlink 指向中央库(`internal/cli/install.go:96-146`);同步引擎独立于 store,纯文件操作,symlink/copy 双模式,带 target-inside-source 防环护栏(`internal/sync/engine.go` SyncSkill + engine_test.go:TestSyncSkill_TargetInsideSource)。但注意:**SQLite 是第二真相源**。技能行、targets、enabled、groups、tags 全在 DB,另有 WriteMetadata 把 DB 状态导出为 `~/.skm/metadata/` 下 JSON"VCS-friendly 镜像"(`internal/store/metadata.go:29`)。整体是双写架构,文件系统不是唯一真相。

形态:CLI + 本地 Web UI(浏览器,非桌面)。技能来源:GitHub URL/shorthand/分支 + 本地路径 + 库内发现(优先 skills/.claude/skills 等目录,回退深度 5 递归,按名去重,`internal/skill/discover.go`)。

## 2. 功能清单

- 多 agent 支持:52 个内置 adapter(46 coding + 6 "lobster"),全部 ProjectDir/GlobalDir/DetectPaths 三元组 [完整但注水] `internal/agent/adapter.go:20-492`。注水点在于 DetectPaths 只探目录存在(`.claude` 等),比 chops 的 evidencePaths 粗
- 安装(git 浅克隆→中央库→symlink→记 target+hash)[完整] `install.go:96-146`
- sync 引擎:IsCurrent 校验链接指向、dry-run 返回 would_sync、批量对全库×全 agent 重部署 [完整] `internal/server/handlers_sync.go:38-108`
- enable/disable:DB 布尔位 + audit 记录,sync 时跳过 disabled(`handlers_sync.go:68-71`)[半成品]。问题在于**已存在的 symlink 不摘除**,disable 后 agent 仍能看到技能直到下次 sync,且下次 sync 也只 skip 不清理;语义不闭环
- groups:命名分组 + `group use <g> -a <agents>` 整组部署到指定 agent(IsCurrent 跳过已同步)[完整] `internal/cli/group.go:200-264`
- 内容哈希:确定性目录哈希(sha256,排序后逐文件,跳 .git/node_modules 等)用于 update 漂移检测 [完整] `internal/skill/hash.go`
- audit log:SQLite append,insert/list/prune(1 万条封顶),所有变更动作(含 batch)都落一条 [完整] `internal/store/audit.go:12-44`,`batchDelete` 处的落点见 `handlers_batch.go:62-66`
- batch 接口:delete/enable/tag/sync 四个批量端点,逐项返回 processed/errors [完整] `handlers_batch.go:15-21`
- 全文搜索/标签/项目级安装/导出:CLI+API 均有 [完整](实现平直)
- 本地 Agent 会话/AI 编写:无。

## 3. 借鉴候选(90 分门槛)

### 3.1 全量变更 audit log
- 是什么:安装/删除/启停/同步/批量每一个变更动作都记一条(action, target, detail, created_at),上限 1 万条自动修剪,Web UI 有专门页面可查。
- 程度:实现简单但纪律好。所有变更路径(包括 batch 循环内逐项)都插日志,插入失败只 Warn 不阻断主操作(`handlers_batch.go:62-66`),这是正确的优先级。
- 为什么够格:skill-zoo 是一个会动用户 dotfiles 的文件管理器,"这个 app 对我的磁盘做了什么"是信任问题。chops/skill-station 都没有等价物。对 skill-zoo 尤其有意义:桌面协议有 CLI 共写本地状态,审计日志是排查"谁改的"的唯一手段。
- 落点:Rust 侧本地协议加一个 append-only JSONL(放 app data,不是真相源,重建缓存时不动它),所有写盘 Tauri 命令收口处追加一行;Local 页加"最近变更"入口。代价小(数天)。与架构零冲突:纯增量观测数据。注意:若 CLI 也写,需进桌面协议文档同一变更,流程上按 AGENTS.md 的 Local Protocol Guardrails 走。

### 3.2 (从宽)确定性目录哈希
- HashDir 的排序+跳过清单写法干净,可用于"远程源有更新"检测。skill-zoo 若做 update 检查可直接照抄算法(`internal/skill/hash.go`),一个函数的代价,无架构影响。单看太小,不占独立格子,因此归入 3.1 之外的顺手抄。

## 4. 明确不借鉴(带理由)

- SQLite 第二真相源 + metadata JSON 双写镜像:与"文件系统是唯一真相"正面冲突,正是 skill-zoo 决策反对的形状;重建-从-扫描的心智模型会被 DB 状态污染。
- enable/disable=DB 标志位:伪需求实现。不摘 symlink 的 disable 骗不了 agent,属于"想法对实现烂",若 skill-zoo 做启停必须落在文件系统(摘链接)。
- groups 批量部署:价值=多选+安装到 N agent 的已有能力加一层持久命名;chops 的 collections 同款思路,非管理器核心闭环,后补抽象。
- 52 个 adapter 大注水:DetectPaths 只查目录存在,且大量 adapter 是无主项目;广度换不来自动发现质量。
- go:embed 单二进制打包:与 Tauri 桌面+独立 CLI 的形态无关,打包方式不迁移。
- dry-run would_sync:好的小细节,但 skill-zoo 安装预检已覆盖同等语义。

## 5. 借鉴裁定

ABSORB: 全量变更 audit log(append-only、所有写路径收口落条、容量上限);顺手抄:HashDir 确定性目录哈希算法备用于 update 检测。其余皆平庸或与 SSOT 决策冲突。
