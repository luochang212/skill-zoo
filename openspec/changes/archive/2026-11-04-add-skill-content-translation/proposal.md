# Proposal

## Why

用户需要在阅读英文技能与参考文档时查看译文，同时保持 agent 使用的原始文件不变。本变更新增手动、按文件的展示层翻译，并建立可由其他功能复用的模型供应商连接层。具体边界来自本次产品讨论与 worth-fix 审阅，不以未提供出处的竞品排他性结论作为依据。

## What Changes

- 本地技能详情中翻译当前打开的 Markdown，包括 SKILL.md 与 references 等子目录中的 `.md`；全部本地来源（含归档、插件、外部导入）可读即支持，不递归、不批量、不翻译外部链接，也不覆盖仓库远程预览和新建未保存技能。
- 在查看/编辑/分屏工具栏紧邻视图切换的右侧加入 Lucide Languages +「翻译」+下箭头的单一下拉按钮；中性样式、轻分隔线，不放入 Skill 管理区、不新增右键菜单。编辑/分屏时禁用，译文与编辑草稿隔离。
- 用户手动触发，流式显示、取消、原文/译文切换、重译；不做自动翻译。首次语言优先设备语言，用户设置后持久化，独立于界面语言。
- 设置分为模型设置（连接、凭据、模型）与翻译选项（目标语言、选用模型、清缓存）；翻译引用供应商与模型 ID，不复制凭据，不在失效后静默换供应商。
- 模型行提供独立参数编辑，支持上下文窗口与最大输出，通过 Rust 读取 Models.dev 公开目录推荐；保留手动覆盖，未命中/离线可手填，不调用 ZCode 私有服务。
- Rust 使用 genai 三协议显式适配与 Tauri Channel；补齐任务身份、取消竞争、输出截断判断、代码保护、有效参数缓存与原子替换。
- 配置与缓存独立于技能目录；CLI、本地技能协议与 fixtures 不变。前端不新增依赖。

## Capabilities

### New Capabilities

- `llm-provider-config`: 三协议连接、模板、模型、凭据边界、原子持久化与损坏/未来版本保护。
- `skill-content-translation`: 当前 Markdown 手动翻译、工具栏、语言与模型偏好、流式生命周期、保真与缓存。

### Modified Capabilities

- `desktop-ui`: 文本输入激活态改为极淡边框变化，保持键盘焦点与可访问名称，按钮/开关不变。

## Impact

- Rust：独立配置存储、LLM 连接层、翻译服务、Tauri 命令；直接运行时新增 genai，沿用已有 reqwest/rustls、regex、sha2 与测试 mockito。
- React：供应商/翻译设置、类型化 API 与 hooks、SkillContentPane 的工具栏与展示；en/zh 同步，保留 ADR 5 的 Unassigned 例外。
- 验证：配置安全/损坏/未来版本、三协议 wire、取消/截断/超时、受保护 Markdown、缓存原子替换、UI 状态与草稿隔离。详见 tasks 与审阅报告。
- 审计依据：`docs/reviews/2026-11-03-skill-content-translation-worth-fix.md`。
