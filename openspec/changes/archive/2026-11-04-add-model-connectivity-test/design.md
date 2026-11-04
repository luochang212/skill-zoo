# Design

## Context

现有 ProviderEditor 持有连接草稿，ProviderUpdate 的空密钥/未变语义已由后端实现。LLM 服务通过显式协议和认证调用 genai，共用应用 HTTP client。见 proposal.md。

## Goals / Non-Goals

验证具体模型的推理路径；不做模型列表探测、自动重试、配置写入或翻译任务。

## Decisions

- 新增 typed IPC 接收 ProviderUpdate 与模型 ID。后端在锁内只读取未替换的密钥，释放锁后联网。沿用现有配置校验，不新增持久化格式。
- 复用 LLM 显式 target 构造和应用 client，使用非流式短请求及 15 秒总截止；输出预算按协议设为 1/1/16。拒绝无有效完成/预算终止状态的响应，允许空文本，避免把推理 token 耗尽误判为不可达。
- 每个模型行增加测试按钮，React Query mutation 控制 pending，现有 toast 显示模型名与耗时或分类错误。草稿修订号隔离迟到结果，组件卸载不弹反馈。
- 不先请求 /models：该接口可能不受服务支持，且能列模型不等于能够推理。

## Risks / Trade-offs

- 最小推理仍可能计费 → 仅显式点击发送固定短提示；提示会发起最小请求。
- Responses 不接受 1 token → 遵循官方最低 16 token 上限，不自动放大重试。
- 模型拒绝小预算 → 如实显示服务响应错误，不将失败包装成成功。

## Migration Plan

无数据迁移，移除 IPC 与按钮即可回退。
