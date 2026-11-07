## MODIFIED Requirements

### Requirement: 禁用删除与可用性
删除 MUST 经确认；禁用供应商或模型 MUST 阻止其被新的翻译生成请求使用。已保存的翻译目标失效 MUST 显示不可用，MUST NOT 静默切换到其他供应商。删除供应商 MUST NOT 删除成功译文，已有缓存读取 MUST 不依赖当前供应商和模型配置。

#### Scenario: 当前目标删除
- **WHEN** 当前翻译供应商被删除
- **THEN** 新生成提示重新选择，下一次生成请求不会自动发给另一家服务；匹配缓存仍可读取
