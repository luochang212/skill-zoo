# Design: add-skill-companion-import-export

## Context

常用指令是设置存储里的 `Vec<SkillCompanionItem { id, content }>`,消费方为托盘菜单(点击复制)。本变更给它加导出/导入,不改变存储与托盘。

## Goals / Non-Goals

- Goals:条目列表能以无损文本形式离开并回到应用;导入与现有列表安全合并。
- Non-Goals:文件导出/导入(后置,等真实备份需求);跨设备同步;导入前预览勾选;CLI 支持。

## Decisions

### D1. 导出目的地只做剪贴板

与产品既有"点击条目即可复制"心智一致,实现是一个薄 command;易失性由"导入接受粘贴文本"的闭环抵消(复制 → 备忘录/聊天中转 → 复制回来)。文件导出留待真实需求。

### D2. 格式:JSON 信封,不导出 id

```json
{ "kind": "skill-zoo-companion", "version": 1, "items": ["…"] }
```

- JSON 全程 UTF-8,`$`/`@`/`/`/引号/换行由序列化器转义,不存在乱码环节;裸文本按行分隔无法容纳多行内容,YAML 对 `@` 开头裸值有保留字问题,CSV 转义与 BOM 烦琐。
- 信封(`kind`/`version`)让导入能明确拒绝无关文本,并预留演进;`items` 用裸字符串数组,可读性最好,未来元数据靠 version 升级。
- id 是本地身份(托盘菜单 id、唯一性校验),跨设备无意义且会撞车;导入重新生成 id,content 才是转移实体。顺带保证导入天然是"新增"语义。

### D3. 格式契约放前端,Rust 只做哑剪贴板 command

导出:前端经现有 `get_skill_companion_items` 读取已保存条目 → 纯函数 `buildSkillCompanionExport` 构建信封 → 新 command `copy_text_to_clipboard(text)`(arboard,与托盘复制同库)写入。

导入:纯函数解析 + 去重 → 组装新列表 → 现有 `save_skill_companion_items` 保存(自带校验、原子写回与托盘刷新)。

理由:格式构建与解析同置一处(同一测试文件锁定往返),Rust 侧保持 IPC 边界薄;"Tauri IPC Is the Only Bridge"不受影响(前端不碰剪贴板,走 command)。

导出读取对话框当前列表(`itemsRef`)而非再发一次 IPC 是安全的:弹窗内新增/编辑/删除/拖拽均即时保存,唯一不保存的中间态是编辑中的 textarea,而编辑态下导出按钮禁用——可导出时对话框状态与已保存设置必然相等。

### D4. 去重:空白归一化,两轮,只追加

键 = trim + 连续空白折叠(与组件内 `normalizePreview` 同一实现,抽到库中共用)。先对导入内容内部去重,再与现有列表去重;新条目按导入顺序追加尾部、重新生成 id;现有条目内容/id/顺序不动。不做覆盖更新——键相同即内容相同,无"更新"可言;不做导入前预览——纯追加无破坏性,toast 报数足够(仪式匹配风险)。

解析失败(非法 JSON / kind 或 version 不符 / items 类型不符)返回结构化错误,组件映射为具体 toast 文案,列表不变。空字符串条目在解析层丢弃。

## Risks / Trade-offs

- 剪贴板被后续复制覆盖 → 用户自行中转保存;文件导出为明确的后置项。
- 归一化把仅差换行/空格的内容视为重复 → 概率低、后果轻(少导一条),反向(肉眼相同的两条)更烦。
- 用户手改导出文本可能带入意外内容 → 解析层只接受字符串数组并丢弃空条目,风险有界。

## Migration Plan

无 schema 迁移:存储键与结构不变,导出格式是新增的对外交换面,不触及 local protocol/fixtures。

## Open Questions

(无——导出仅剪贴板、空白归一化去重已与需求方确认。)
