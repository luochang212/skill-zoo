# Tasks: add-skill-companion-import-export

## 1. 前端纯函数库

- [x] 1.1 新建 `src/lib/skill-companion-transfer.ts`:`buildSkillCompanionExport(items)` 构建信封 JSON;`parseSkillCompanionImport(text, existing)` 返回结构化结果(新条目内容/跳过重复数或类型化错误);空白归一化去重函数
- [x] 1.2 同目录 `skill-companion-transfer.test.ts`:特殊字符与多行往返无损、信封字段、非法输入拒绝(非法 JSON/kind/version/items 类型/空条目)、文件内去重、对现有列表去重、只追加语义

## 2. Tauri command

- [x] 2.1 `src-tauri/src/commands/settings.rs` 新增 `copy_text_to_clipboard(text)`(arboard),在 `lib.rs` 注册

## 3. UI 与 i18n

- [x] 3.1 管理弹窗 footer 增加"导出/导入"按钮:非编辑态可用,导出空列表禁用;导出读已保存条目 → 构建信封 → 写剪贴板 → 成功/失败 toast(带条数)
- [x] 3.2 导入对话框:粘贴 textarea + 确认;解析失败 toast 具体原因且不改列表;成功后合并追加、经 `useSaveSkillCompanionItems` 保存、toast 报告"导入 N 条,跳过 M 条重复"
- [x] 3.3 i18n 中英文同改(`src/i18n`):导出/导入文案、成功与失败 toast、导入对话框标题与占位符

## 4. 验证

- [x] 4.1 `bun run test`;`bun run lint`;`bun run format`
- [x] 4.2 `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml`
- [x] 4.3 `openspec validate --all --strict`
