## Implementation

- [x] 1. 安装两个插件，接入共享解析链的只解析入口。
- [x] 2. 补充 CJK、GFM、代码、转义和清洗边界测试并更新阅读器说明及主规格。
- [x] 3. 验证测试、类型、lint、格式、构建、OpenSpec 与浏览器运行。

## Verification

- 新增 12 个解析回归场景；接入前 7 项失败，接入后全部通过。
- `bun run test`: 47 个文件、432 项测试通过。
- `bun run typecheck`、`bun run lint`、`bun run format:check`、`bun run build` 通过。构建仍有原有 theme-init.js 与 chunk 大小提示。
- Chromium、WebKit 实际组件运行：中日韩加粗、删除线、代码字面量与清洗样例通过。未在 Safari 16.4 真机实测。临时浏览器页面已清理。
- 实际构建 JS gzip 从约 523.48KB 增至 529.48KB。
- 主规格已同步，并与本变更 delta 正文逐字核对；`openspec validate --all --strict` 通过。
