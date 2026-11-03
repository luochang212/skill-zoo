# 未提交 OpenSpec 改进建议报告

日期：2026-11-03。范围：`openspec/changes/add-skill-content-translation/` 的 proposal、design、tasks 与两个 spec delta。审阅时 Git 中只有这一项未跟踪 change，尚无功能实现。

结论：展示层翻译、Rust 网络边界、独立配置与缓存的方向合理；建议补齐下列契约后再实施。当前问题主要是任务生命周期、成功条件与内容身份没有闭合，不需要重构现有应用，也不足以否决 genai。OpenSpec 格式通过不代表行为已可验收。

本报告只新增审阅记录，没有修改原始工件或产品代码。P1 表示实施前应解决的正确性缺口；P2 表示本次计划内值得补齐的边界；不是已发布产品的事故定级。

## 1. P1：取消机制存在错误前提，任务 ID 的交付也未定义

**判定：drop 即取消的前提已由库级实测证伪；任务协议缺口由工件直接确认。值得改，成本低。**

位置：design D3、Verification 的 Channel 行；tasks 3.1–3.2。

design 写的是 `HashMap<task_id, AbortHandle>`，通过 drop 句柄终止请求。Tokio 的 AbortHandle 释放不会取消任务；futures 的同名句柄也不能据此实现取消。Tauri Channel 是传输通道，不能从通道存在、回调释放或发送失败自动推导 HTTP 请求已终止。[Tokio 官方文档](https://docs.rs/tokio/latest/tokio/task/struct.AbortHandle.html)明确区分了 drop 和 `abort()`。

另一个独立缺口：translate 命令参数、三个事件均无 task ID，也没有定义立即返回 task ID。若 invoke 等翻译结束才返回，页面离开时前端可能还没有可取消的身份。

触发链：开始请求 → 用户切换技能 → 前端不知道 ID 或后端仅 drop handle → 请求继续消费资源，甚至仍提交缓存。是否真的发生取决于未来实现；不能把尚未写出的实现称为已复现 bug。

**最小建议：** 定义前端何时取得 ID、注册完成与取消的顺序；后端显式 `abort()` 或等价取消机制；定义完成/取消竞争的提交点，清理注册表并丢弃旧任务事件。取消只能保证客户端停止请求，不能承诺供应商服务端立即停止生成或计费。

**验收：** 首个 Delta 前立即离页；同一技能快速重译；取消与完成同时发生；迟到事件不影响新页面。明确哪个终态胜出，以及胜出后是否允许缓存提交。

## 2. P1：正常结束的流不等于完整译文

**判定：源码支持这一风险；应用层后果尚未实测。值得改，成本低至中。**

位置：translation spec「译文缓存」「内容上限与错误处理」；design D4/D5；tasks 2.4、3.2。

现有条件是“流正常结束即缓存”。genai 0.7.2 的 `chat/chat_stream.rs` 中 `StreamEnd` 提供 `captured_stop_reason`；`chat/chat_response.rs` 将 `length`、`max_tokens`、`incomplete` 等归入 `StopReason::MaxTokens`；OpenAI streamer 收到 `[DONE]` 时仍可以携带该结束原因。因此 HTTP/SSE 正常完成与内容完整是不同维度。

触发链：模型输出上限较小 → 只生成半篇译文 → 流正常结束 → 当前计划允许把半篇作为成功缓存 → 无 TTL 下长期复用。50KB 源文限制不能保证输出 token 充足。

**最小建议：** 明确成功标准，区分正常完成、输出截断、拒绝、空结果和未知终止原因；截断不得标记 Completed 或覆盖旧成功缓存。未知原因的兼容策略需写清，避免一律拒绝所有兼容网关，也避免一律当成功。

**验收：** 三协议至少覆盖成功及截断事件；空响应、拒绝、缺失终止标记的行为可断言。当前只有 OpenAI 兼容端点的集成计划，不足以覆盖三协议承诺。

## 3. P1：逐字符保真是硬承诺，实现却只有 prompt

**判定：计划中的保障与验收不充分；没有实测证明某个模型一定违规。值得改，成本中。**

位置：translation spec「翻译保真规则」；design D5；tasks 2.2。

spec 要求命令、代码逐字符不变，并称“可照常复制执行”；task 只断言 prompt 包含约束。这能证明指令写进去了，无法证明模型输出遵守指令。源文可能包含翻译指令、嵌套围栏或复杂 YAML，任意可配置模型也没有确定性保障。

后果分层：最重是用户复制已被改变的命令；较常见是代码/路径失真；最轻是 Markdown 或 YAML 展示损坏。译文不写回技能目录可保护 agent 原文件，不能保护用户复制出的文本。

**最小建议：** 若保留硬承诺，确定性保护或恢复明确可解析的代码块、行内代码、链接目标与不翻译的 frontmatter；校验失败不可静默作为可信成功缓存。自然语言中的“命令/路径”和所有 Markdown 结构无法仅靠简单提取全面保证，应将可保证的范围与模型翻译质量目标分开。不要为此扩建一套通用 Markdown 编译框架。

**验收：** 给翻译服务注入会改写保护区域的模型响应，验证最终输出恢复原文或明确失败。包含 YAML 多行 description、嵌套围栏、反引号、链接与源文指令；不能继续仅检查 prompt 字符串。

## 4. P2：翻译的内容身份与页面范围不明确

**判定：RepoDetail 复用论断被现有代码证伪；其余是缺失的产品契约。值得改，成本低。**

位置：design Context、D3/D6；translation spec 入口与失效；tasks 6.1、6.5。

实际代码：`RepoDetail.tsx:103` 经 `useSkillPreview` 获取仓库内容，`:478` 直接渲染 `MarkdownContent`，没有复用 SkillContentPane。`SkillContentPane.tsx:233` 区分当前文件是不是 SKILL.md，overview 也能查看辅助文件。SkillDetail 另有可编辑 content 与 dirty 状态；拟议命令却只有 skill_id。

因此需要回答：本次是否覆盖未安装的仓库预览？按钮是否仅在 SKILL.md 激活时出现？有未保存草稿时翻译屏幕文本还是磁盘原文？翻译过程中保存新内容、切换语言后，旧 Delta 能否继续显示？归档身份又如何交给后端读取？

**最小建议：** 明写支持的页面与源内容。本次若只覆盖本地详情，就纠正 RepoDetail 论断并明确排除远程预览；若覆盖远程，补后端内容读取与身份契约。SKILL.md 与辅助文件入口不能只靠 overview 判断。明确草稿策略，以源内容修订/目标语言/请求代次绑定结果，禁止旧结果挂到新原文上。

**验收：** 未保存草稿、辅助文件、同技能内容更新、运行中切语言、归档与插件来源。无需因此重构全部预览组件。

## 5. P2：缓存身份遗漏生成参数，重译又提前破坏旧缓存

**判定：工件内部不一致属实。值得改，成本低。**

位置：design D4；provider spec「禁用与删除」；translation spec「失效与重新翻译」；tasks 2.3、6.3。

目前键有协议、URL、模型、headers、语言、内容，没有 `maxOutputTokens`、`reasoningLevel` 或翻译策略版本。调整输出上限后仍可能命中此前结果；未来修复 prompt 也不会自然失效。provider spec 还称删除供应商后缓存自然不命中，但键没有供应商 ID，相同配置重建或另一同配置条目仍能命中。

重译的 design 是“删除该条目后重发”，而 spec/tasks 要保留旧译文直到替换成功。内存可以暂时保留它，但重译失败后再开页面，旧成功缓存已经丢失；不必要地增加重试成本。

**最小建议：** 对规范化的结构化有效请求参数做 hash，加入翻译策略版本；决定跨供应商同配置是否共享缓存，并改正删除后的解释。API Key 不必仅为轮换而加入键。重译只跳过读缓存，成功后原子替换，失败/取消保留旧条目。

**验收：** 输出参数变化、header 顺序等价、策略版本变化、同配置重建供应商、重译失败保留旧缓存；清缓存与在途任务并发时明确允许或禁止重新写入。

## 6. P2：供应商能配置，尚未定义怎样实际选用

**判定：行为与任务覆盖缺口属实。值得改，成本低。**

位置：两个 spec 的供应商可用性；design D2/D6；tasks 3.1、4.3、5.3。

存在多供应商/多模型，但没有首次默认选择、选择入口和当前目标失效后的行为。后端只要求“供应商启用、模型存在”，没有明确拒绝已禁用模型。`reasoningLevel` 被承诺可编辑，却没有取值集合、协议映射与不支持时的行为。空 Key 对本地服务是否合法也不明确。

**最小建议：** 补充首次选择、记忆与失效回退规则；不能静默切换到另一个收费端点。后端也校验模型启用状态。定义本地无认证请求与远程凭据规则；定义推理档位映射，或从本次配置 UI/schema 中移除尚无执行语义的字段。仍可保留三协议和多供应商，不必擅自拆成 v1/v2。

**验收：** 全模型禁用、删除/禁用当前目标、空模型 ID、同供应商重复模型 ID、零/非法 token 上限、本地无 Key、不支持的 reasoning 档位。

## 7. P2：Base URL 的“合法”不足以保证请求地址正确

**判定：genai 源码与 URL 库级实测确认路径差异；缺少输入约定。值得改，成本低。**

位置：provider spec 字段校验；design D1/D2。

genai 0.7.2 `adapter/adapters/openai/adapter_shared.rs` 使用 `Url::join("chat/completions")`。`https://example.test/v1` 和带尾斜杠的 `/v1/` 会产生不同地址；单纯“可解析为 URL”还会接受不能作为 HTTP 端点的 scheme。自定义 headers 与 SDK 认证头冲突时谁优先也未定义。

**最小建议：** 定义 Base URL 是 API 根目录而非完整方法 URL；规范化尾斜杠与协议路径，限制为 HTTP(S)，保留本地 HTTP 服务。明确请求头冲突的拒绝或覆盖规则，按最终有效请求参数构建缓存键。不要因此禁止 localhost，也不需要把用户自己配置的服务一概视为 SSRF 攻击。

**验收：** `/v1`、`/v1/`、自定义多级前缀、非法 scheme，以及三协议实际 wire 路径/认证头。只测 AdapterKind 枚举不足以证明网关可用。

## 8. P2：凭据配置的读写边界与恢复流程不足

**判定：spec 未闭合；尚无实现可证明泄漏或数据损坏。值得改，成本低至中。**

位置：provider spec「配置持久化与版本迁移」「凭据不进入日志」；tasks 1.2–1.5。

日志脱敏与磁盘 0600 是合理起点，但未规定 list/read 是否把保存的 Key 和凭据 headers 传回前端。现有 github-connection spec 已有后端保留 secret、前端 mask 的先例；新能力未必受其专有 requirement 约束，仍应显式选择同等安全边界。

损坏文件场景同时承诺不覆写和重新保存写入新文件，但新文件名、下次启动读取哪个、恢复失败时的行为都未定义。高版本文件的未知 schema 也不能保证一定可解析并“展示既有条目”。0600 是 Unix 语义，当前 spec 却作了跨平台的仅当前用户读写承诺。

**最小建议：** 使用不含 secret 的读取 DTO，编辑采用未变/替换/清除语义；所有凭据头也按 secret 处理。保存原子落盘，成功后再切换内存状态，临时文件也限制权限。损坏配置选择明确备份恢复或阻止写入流程。未来版本默认拒写，只有可安全理解时才展示；Unix 写明 0600，Windows 单独确定 ACL 策略，避免假承诺。

**验收：** list 不含 secret、未改 Key 保存不会清空、持久化失败不替换运行时配置、损坏文件恢复后重启、高版本未知字段、旧临时文件权限。无需为本次强制引入 Keychain。

## 9. P2：用户取消和异常断流混淆，超时没有执行策略

**判定：文本歧义与配置遗漏属实。值得改，成本低。**

位置：translation spec 最后一条 requirement；design D7；tasks 2.4、3.2。

同一 requirement 先将流中断列为失败并要求错误/重试，随后又说“流式过程中断按取消处理”。不弹错误窗口与不展示失败状态本可兼容，但这句话使网络断流也可能被当作用户取消。复用的 `config::http_client()` 没有全局 timeout；genai 提供 `stream_header_timeout`、`stream_read_timeout`，计划尚未使用。

**最小建议：** 只有主动取消/页面离开进入 cancelled；异常 EOF、认证、限流、超时进入 failed，内联展示并允许手动重试。设置首响应、流空闲与必要的总时限，给出有界策略；不自动重试付费生成。明确失败对已有成功译文的保留行为。

**验收：** 请求不返回 headers、流中途停住、异常断流、主动取消分别落入对应终态，无部分缓存。

## 保留、延后与证据勘误

- **保留 genai + 三协议 + Channel。** 现有探针二进制本轮运行成功，输出 `with_reqwest(app reqwest 0.13) = OK`、`OpenAIResp`、`temperature = None`。这支持类型与基础选型，不证明所有供应商 wire 行为、取消或保真。没有证据值得推翻选型改写三套 SSE。
- **保留展示与技能文件隔离、前端零新增依赖、不动 CLI 本地协议。** 符合 ADR 1 的自持协议边界；新增独立配置本身不要求修改技能协议 fixtures。新增 i18n 时遵守 ADR 5，不能改动刻意保留的 `Unassigned`。
- **50KB 限制可保留，但缩小论据。** 84 个含软链重复的本机样本只能支持暂定上限，不能证明社区分布或“分块是伪需求”。写清 50,000 还是 51,200 字节，并以 UTF-8 字节计量。暂不值得开发长文分块与自动语言检测。
- **延后拖拽排序、泛化迁移框架。** 拖拽只有 design/tasks，没有排序字段或行为 spec；不是翻译核心路径。schemaVersion 与未知版本拒写值得做，但 v1 无历史版本，不必凭空造 v0 数据迁移。若坚持排序，必须连持久化与键盘操作一并定义。
- **不把调研调用次数视作验证。** design Verification 写“证据链接齐全”，当前工件没有实际调研报告位置、仓库提交或链接。proposal 的“仅一个项目”“主流均为空白”本轮未独立验证，不应沿用“坐实”。补可复查出处或删去对实现无影响的绝对断言，不值得为排他性市场结论再扩成全面竞品研究。
- **ADR 按价值判断记录。** tasks 7.4 将某条新 ADR 写成必交付项，AGENTS 要求先判断现有资料会丢失什么。本 change 已保留大量选型理由，应先判断哪些约束需长期主动提醒，避免只重复归档记录；不是每次依赖选型都必须新增 ADR。
- **收尾任务消除歧义。** tasks 7.3 的“无需同步”只能指既有 capability；归档仍须将两个新能力同步到主 specs。门禁中的 cargo 命令统一加 `--manifest-path src-tauri/Cargo.toml`，补 format check 与仓库要求的 `adrkit validate --all`。

## 建议的修订顺序

1. 先统一任务身份、取消/完成提交点、源内容修订、成功标准和保真承诺（1–4）。
2. 再补有效目标选择、URL/认证、缓存与配置恢复契约（5–9），使 proposal、spec、design、tasks 表达同一种行为。
3. 把上述验收转成实现任务，优先使用本地 mock 与可控响应，不消费真实 Key；最后修正证据等级与收尾命令。

这些修订可以在原 change 内完成，无需拆出平台重构，也不需要扩大到聊天、RAG、工具执行或通用供应商框架。

## 本轮验证与边界

- 已运行 `openspec validate --all --strict`：15/15 通过。
- 已运行 `adrkit validate --all`：通过；`git diff --check` 通过（报告为新文件，不把此命令当作其格式校验）。
- 已运行 `adrkit list`、相关路径检索，完整阅读 ADR 1、5；无作用域命中时补充了清单与正文判断。
- 已检查真实组件、HTTP client 和本机 genai 0.7.2 / Tauri / Tokio / futures 源码，运行既有 genai 探针二进制。
- 功能尚未实现，不能直接调用不存在的 translation 生产函数；本文将文档矛盾、库级验证和应用层推演分开。未运行产品全量测试、真实供应商请求、模型保真测试或跨平台权限实测，不将这些称为已验证。
- 本轮库级最小探针位于 `/tmp/skill-zoo-worth-fix-20261103/`，通过 `cargo run --quiet --manifest-path /tmp/skill-zoo-worth-fix-20261103/Cargo.toml` 运行成功。临时目录不作为长期证据唯一载体，以下保留关键用例与实际输出；实现时应将修正后的断言固化为回归测试。

探针使用真实库：Tokio 任务等待 oneshot，drop abort handle 后释放 oneshot，任务仍返回 42；futures Abortable 也仍返回 Ok(42)。核心代码如下（Tokio 部分在 current_thread runtime 内执行）：

```rust
let (release, wait) = tokio::sync::oneshot::channel::<()>();
let task = tokio::spawn(async move { wait.await.unwrap(); 42 });
drop(task.abort_handle());
release.send(()).unwrap();
assert_eq!(task.await.unwrap(), 42);

use futures::{future::{AbortHandle, Abortable}, FutureExt};
let (handle, registration) = AbortHandle::new_pair();
drop(handle);
assert_eq!(Abortable::new(async {42}, registration).now_or_never(), Some(Ok(42)));

for base in ["https://example.test/v1", "https://example.test/v1/"] {
    println!("{base} -> {}",
        reqwest::Url::parse(base).unwrap().join("chat/completions").unwrap());
}
```

实际输出：

```text
tokio: drop AbortHandle -> task completed (not cancelled)
futures: drop AbortHandle -> future completed (not cancelled)
https://example.test/v1 -> https://example.test/chat/completions
https://example.test/v1/ -> https://example.test/v1/chat/completions
```


## 实施回填（2026-11-03）

本节记录审阅后的落实，前文保留为当时的判断。用户后续确定取消自动/右键翻译，采用内容工具栏 Languages + 翻译 + 下箭头；目标语言从设备偏好初始化，修改后记住。覆盖当前本地 Markdown，包含 references，供应商与翻译偏好分离。

9 项问题已进入变更 `add-skill-content-translation` 的 specs/design/tasks 并实现：预注册任务与显式 abort、完整终止原因判定、确定性 Markdown 保护、当前文件与已保存快照校验、有效参数缓存及重译原子替换、显式模型选择、规范化 URL/认证头、write-only 凭据与损坏配置备份恢复、取消/失败分流及有界超时。未增加泛化迁移、排序或重复 ADR。

验证：前端全量 285 测试通过；Rust 全量 313 通过、2 个既有 ignored；项目标准 Clippy、类型、lint、format、生产构建通过；最后受影响模块追加验证通过。浏览器使用真实组件与模拟 IPC 验证工具栏及原文隔离，未使用真实 Key。两个主 specs 已同步，严格校验 17/17，ADR 校验通过；详细命令、证据与边界见该 change 的 design Verification。未改本地协议、fixtures 或 CLI；change 保持未归档。
