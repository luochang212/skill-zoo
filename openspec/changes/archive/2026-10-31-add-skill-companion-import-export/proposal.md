# Proposal: add-skill-companion-import-export

## Why

常用指令(Skill Companion)只存在于单机设置存储中,没有离开当前设备的途径:换机、重装或分享给同事时,用户只能逐条手动复制。需要一个低摩擦的导出/导入闭环,把条目列表以无损的文本形式带出和带回。

## What Changes

- 新增**导出**:管理弹窗提供"导出"动作,把当前已保存的常用指令列表序列化为带版本信封的 JSON 文本(`{"kind":"skill-zoo-companion","version":1,"items":[...]}`),写入系统剪贴板;成功/失败以 toast 反馈,成功文案携带条数。不做文件导出。
- 新增**导入**:管理弹窗提供"导入"动作,弹出对话框粘贴导出文本;解析同一信封格式,条目按空白归一化去重(先在导入内容内部去重,再与现有列表去重)后追加到列表尾部,id 重新生成;结果以 toast 报告"已导入 N 条,跳过 M 条重复"。
- 新增一个前端纯函数模块承载导出/解析/去重逻辑(可单测),以及一个写剪贴板的 Tauri command。
- 导出格式中的特殊字符(`/`、`$`、`@`、引号、换行、中文)必须无损往返;信封使导入能明确拒绝非本应用导出的文本。
- 不改变存储 schema、托盘行为、CLI 或 local protocol fixtures。

## Capabilities

### New Capabilities

- `skill-companion`:常用指令条目的转移契约——导出到剪贴板的信封格式、导入解析与去重合并语义。现有条目管理(增删改、拖拽排序、托盘点击复制)为既有行为,本次不追溯立规。

### Modified Capabilities

(无)

## Impact

- `src/lib/skill-companion-transfer.ts`(新):导出/解析/去重纯函数 + 同目录单测。
- `src/components/settings/SkillCompanionSettings.tsx`:管理弹窗 footer 增加"导入/导出"按钮,新增导入对话框。
- `src/lib/api/settings.ts` + `src-tauri/src/commands/settings.rs` + `src-tauri/src/lib.rs`:新增写剪贴板的 Tauri command 并注册。
- i18n:`src/i18n/` 中英文同改。
- 不触及 `fixtures/local-protocol/`、托盘代码、CLI。
