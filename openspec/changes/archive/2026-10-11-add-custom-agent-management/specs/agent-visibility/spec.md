## ADDED Requirements

### Requirement: 自定义 agent 的可见性与顺序一致

已注册自定义 agent MUST 与内置 agent 使用相同的可见性、排序、最后一个可见 agent 保护、上限只约束增长及隐藏后尽力清理规则。新增 agent 在可见数量少于 7 时 MUST 默认可见并追加到可见组末尾；否则 MUST 保存为隐藏并解释原因，不得自动隐藏其它 agent。

#### Scenario: 上限内新增
- **WHEN** 当前可见 agent 少于 7 个且用户新增自定义 agent
- **THEN** 新 agent 默认可见并追加到可见组末尾，可排序、搜索及隐藏

#### Scenario: 已达上限时新增
- **WHEN** 当前可见 agent 已达到或超过 7 个且用户新增自定义 agent
- **THEN** 新 agent 注册成功但保持隐藏，界面说明达到可见数量上限，并提供前往管理可见性入口

#### Scenario: 自定义 agent 隐藏清理失败
- **WHEN** 用户隐藏自定义 agent 且应用链接清理失败
- **THEN** 隐藏保存成功，实体技能和外来链接不受影响，界面展示与内置 agent 一致的简洁提示

#### Scenario: 移除最后一个可见 agent
- **WHEN** 用户试图注销唯一可见的自定义 agent
- **THEN** 操作被拒绝并引导先显示另一个 agent，所有登记和文件保持不变
