# Evidence

来源：2026-10-15 对 `gh skill`（cli/cli v2.102.0）的独立评审，由两轮互补分析构成——本方源码级分析 + Codex（`codex exec`，中立提示词、自主探索）的运行时实测。工件从临时目录 `/tmp/gh-skill-review.mM0tji/` 抢救留存（二进制与源码树未保留）。

- `report.md` — Codex 的完整结构化报告（事实清单按 实测/源码确认/推断/价值判断 分层标注，含 file:line 与复现方法）
- `go-lock-tests.log` — 对上游真实 `lockfile.readFrom/writeTo` 的 Go 测试：本仓 fixture 往返后 `ref`/`commitSha` 被剥（核心缺陷实证）；v4 输入返回空 v3（未来版本整表重置风险）
- `rust-lock-test.log` / `rust-roundtrip.json` — 本方生产 `services/lock.rs` 类型对 gh 形态 JSON 的往返：`pinnedRef` 丢失（反向有损实证）
- `runtime_probe.py` / `runtime-probe.log` — 正式 gh v2.102.0 二进制实测：目录 symlink 扫描跳过、`--from-local --force` 沿链接写入覆盖目标

复现边界与未实测项见 `report.md` 末节「验证边界与产物」。
