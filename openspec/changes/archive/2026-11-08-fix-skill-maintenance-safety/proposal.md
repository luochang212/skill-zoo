# Proposal

## Why

维护诊断发现清缓存会删除活跃下载，更新目录替换与 lock 写入分离，且检查会把未知安装版本补写为今天的远端版本。用户要求按 worth-fix 复核后只修有收益的问题，保留现有结构和安全边界。

## What Changes

- 仅统计/清理完整 ZIP，排除临时文件、链接与未知文件，报告实际清理失败；界面重新读取大小。
- 使用下载归档的 commit 查询 tree，核对候选 folder SHA，变化时保留本地并要求重检；安装也从同一归档建立版本基线。
- 每个技能保留备份到 lock 发布成功，发布失败恢复原目录。
- 未知版本保持未知并报告问题，删除盲目自动补基线。
- 插件开关保持 pending 直至刷新完成，复用返回列表。
- 不扩容应用缓存清理，不重写 Settings/更新架构，不在没有渲染 trace 的情况下引入虚拟列表或新扫描缓存。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `repo-zip-download`: 清理与统计范围不包含活跃下载。
- `skill-installation`: 安装/更新基线与实际下载内容一致，更新 lock 失败回滚目录。
- `local-protocol`: 缺少安装版本的状态保持未知，双端往返保留。

## Impact

Rust settings/cli/lock 服务、Settings hooks 与维护组件、协议文档与共享 fixture、Rust/CLI/前端回归测试。无依赖、schema 版本或已有字段形状变更。更新每仓库增加一次归档 commit 的 tree 查询；缺失身份/查询失败时拒绝更新并保留本地，安装可降级为未知版本。

证据：缓存保护测试 red；lock 故障注入 red；插件生产扫描 2,632 条，冷扫描 4,374.93 ms、七次中位 1,150.05 ms。完整复核与边界见 docs/reviews/2026-11-08-skill-maintenance-assessment.md。未以扫描时间冒充 UI trace。
