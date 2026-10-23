# Tasks

研究交付已完成;本 change 不实施任何修复或功能。综合裁定与 co-design 见 [design.md](design.md),方法与边界见 [verification.md](verification.md),逐仓证据见 [evidence/dossiers/](evidence/dossiers/)。

## 1. 准备

- [x] 1.1 建立 [evidence/dossiers/](evidence/dossiers/) 与档案模板(90 分门槛写入模板)。
- [x] 1.2 克隆 16 个竞品仓库(`--depth 1`)到 `~/Documents/GitHub/competitor-research/`(快照 2026-10-14)。

## 2. 逐仓深读(每个竞品一份档案,含借鉴裁定)

- [x] 2.1 桌面 GUI 直接竞品:xingkongliang/skills-manager、jiweiyeah/Skills-Manager、chrlsio/agent-skills、AFunc-OPC/Skiller(裁定:3 ABSORB / 1 NOTHING)。
- [x] 2.2 桌面/micro GUI:Shpigford/chops、wujiyu115/skm、xtianowner/skill-station、kevinpinscoe/skills-tui(裁定:2 ABSORB / 2 NOTHING)。
- [x] 2.3 CLI 包管理器:luongnv89/asm、enulus/OpenPackage、knoxgraeme/skillfish、stakpak/paks(裁定:1 ABSORB / 3 NOTHING)。
- [x] 2.4 TUI/agent 自管理/生态:JoeHe0x/skill-man、aclemen1/claude-skill-manager、obra/superpowers(概念级)、lsdefine/GenericAgent(概念级)、`gh skill`(文档级)(裁定:3 ABSORB / 2 NOTHING)。

## 3. 综合与 co-design

- [x] 3.1 汇总各档案 ABSORB 候选,逐条过 90 分门槛复核:市场缓存降级与审计日志降为待核查项(§2-H),两处档案间张力显式裁定(§2-B adopt、§2-E tree-SHA)。
- [x] 3.2 撰写 co-design(design.md §2):8 个吸收主题 + 蓝图存档,逐项含来源证据、落点、代价、开放问题。
- [x] 3.3 撰写「已评估并拒绝」清单(design.md §3,20 行,每项一句话理由)与 verification.md。

## 4. 转出:后续 change 队列(已于 2026-10-14 产品评审后全部否决/搁置,当前无待立项项)

- [x] 4.1 ~~agent 自管理协议~~ 搁置:机器接口无近期调用方,companion skill 失去地基;随该方向重新立项时前置评估。
- [x] 4.2 ~~安装期静态风险扫描~~ 否决:未获规则维护承诺,三问检验不过。
- [x] 4.3 ~~ComposePanel~~ 搁置:待编辑器真实使用数据。
- [x] 4.4 ~~gh 语义对齐~~ 解散:钉定取消、校验器否决、tree-SHA 更新经实证已有。
- [x] 4.5 ~~plugin 来源只读识别~~ 否决:不扫插件市场是有意决策,skills 与 plugin 两平面不混合。
- [x] 4.6 ~~attention budget~~ 搁置。
- [x] 4.7 卫生包各项非常驻队列,碰到对应代码时按 §2-H 条目顺手处理;两项前置核查(审计日志现状、React Query 持久化)保留为随手核查。

## 勘误记录

- 2026-10-14 用户评审后撤回「adopt 孤儿收养」(原 4.2/P1):该建议是世界观移植错误。skill-zoo 视本地技能为一等 origin,「不隐式删除、移动用户实际文件」是技术红线,孤立本地技能不是不一致状态;且哲学兼容的收养已存在于 `merge_duplicates_to_ssot`(src-tauri/src/services/skill.rs:2097,重复+用户确认才动文件);迁走 `npx skills` 安装的技能还会造成官方 CLI update/remove 行为未定义。详见 design.md §2-B。
- 2026-10-14 产品评审否决「plugin 来源只读识别」(4.5):不扫描插件市场是有意决策;skills 与 plugin 是两个管理平面,不得混合呈现。详见 design.md §2-F。
- 2026-10-14 产品评审取消「SHA 钉定/gh 语法对齐」(§2-E 第 1 条,连带 upstream change 队列 B2):更新流程已是"展示变更 → 用户主动升级",钉定无问题可解。详见 design.md §2-E。
- 2026-10-14 产品评审整体否决/搁置剩余队列:agentskills.io 校验器(三问检验不过;原「不合规 name 可能加载失败」的严重性陈述未经实证,已勘误)、CLI 机器接口与整个主题 A(无近期调用方,随之搁置)、风险扫描(无维护承诺)、ComposePanel/attention budget(搁置)。队列清空,当前无待立项项;各触发条件见 design.md §2/§4。

## Workflow follow-up

- 保持本 change 供评审;不自动 archive。
- 蓝图存档(design.md「蓝图存档」节:xingkongliang git 备份对象级合并协议)仅供未来备份/多机同步立项时引用,不排期。
