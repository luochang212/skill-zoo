---
status: implemented
date: 2026-10-23
raised-by: human
decided-by: human
created: 2026-10-23
commit: 52b4213
description: 在改动 agent 事务验证，或考虑把 Verus 纳入生产构建之前阅读。
paths:
  - src-tauri/src/persistence/agent_transaction.rs
  - src-tauri/src/services/cli.rs
  - docs/local-protocol.md
  - docs/research/verus-transaction/**
---

# ADR: 3 让 Verus 保持可选，且不进生产构建

## Problem

Skill Zoo 的日志恢复机制在操作只完成一部分时保护用户文件。Verus 可以针对显式规约证明 Rust 逻辑，但我们的关键流程还依赖文件系统操作、外部写入方，以及一套独立的 TypeScript CLI。对一个脱离出来的模型做证明，无法确立这些实现或它们的存储假设是正确的。

两项范围有限的研究演示了抽象的重放性质，并产出了有用的生产路径失败/重试测试。它们没有发现新的生产缺陷。要进一步扩大集成，必须先维护一条与运行时代码的对应关系，并确立可信的存储边界，才能宣称更强的面向用户的保证。

## Decision

- 把小模型、可复现运行器与证据保留在 `docs/research/verus-transaction/` 下，作为可选的研究产物。
- 把真正的 Rust/CLI 恢复失败、重试与租约释放测试留在各自的常规测试套件里。它们直接打在生产线行为上。
- 不 vendor Verus 二进制、其源码分发包或 Rust 工具链。复现研究时使用独立安装的验证器。
- 不新增任何 Verus 生产依赖、默认构建步骤、必需的 CI 关卡，或全项目级的 Rust 工具链覆盖。
- 不为了让 Verus 兼容而改写那点生产选择/重放逻辑。当出现足够复杂、稳定的共享核心，值得付出证明与维护成本时再重议采纳；在把证明当作生产保证之前，先明确并评审可信 IO 边界。

这条边界由用户在审阅两项研究后确认。本地协议语义与桌面端/CLI 的 fixture 一致性仍归 ADR 1 所有（[原文](1-own-skill-zoo-local-protocol-borrow-capabilities-not-compatibility.md)）。

## Alternatives considered

- **现在就要求整个后端使用 Verus。** 否决：IO 与异步集成还需要额外建模，同时并未演示出新的生产安全收益。
- **丢弃全部实验产物。** 否决：这些小型可选示例以很小的成本保留了可复现的证据、假设与负向检查。
- **把模型证明称为端到端验证。** 否决：对应关系与真实的文件系统效果都仍未证明。

## Consequences

应用保留既有的构建与 CI 流程。真实失败/重试覆盖得到改善，同时没有给贡献者增加编译器依赖。研究保留下来供后续使用，并明确标注为「仅模型」。

### Verification

[研究总览](../../docs/research/verus-transaction/README.md)与[第二轮报告](../../docs/research/verus-transaction/round2-production-recovery.md)拥有命令、锁定的验证器细节、结果与局限。保留的运行器会拒绝刻意引入的实现错误；生产路径测试用共享协议 fixture 跑两套运行时。两项研究都不需要改动运行时实现或 schema。

### Trade-offs

可选模型会与生产脱节，因此复用前需要评审其假设与对应关系。Verus/vstd/rustc/solver 的可信性与真实 IO 行为不在本文确立的保证范围内。测试与抽象证明既不能确立物理断电下的正确性，也没有缩短 hash 到 rename 之间的窗口。
