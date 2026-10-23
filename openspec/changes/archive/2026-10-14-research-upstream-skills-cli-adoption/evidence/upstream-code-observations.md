# 上游源码与 PR 观察（抓取于 2026-10-14）

## PR #2067「fix: use ~/.agents/skills for Codex global skills」（v1.7.2）

PR 正文（`gh pr view 2067 --repo vercel-labs/skills`）关键引用：

> Update the Codex global skills directory from `~/.codex/skills` to `~/.agents/skills`, matching the current Codex skills documentation.
>
> @etraut-openai (11 Mar 2026): `~/.codex/skills` is the old (legacy) name. The industry has since standardized on `~/.agents/skills`. We recommend moving to this directory, which is why the documentation reflects this.

即：**OpenAI 官方**确认 `~/.agents/skills` 是 Codex 的标准位置，`~/.codex/skills` 为 legacy。改动文件：README.md、src/agents.ts。PR 还列出同方向的后续 issue（#1060、#1372、#1874、#2028），可见上游在逐步把更多 agent 收敛到共享目录。

## 上游 agents.ts（main，2026-10-14）

```js
const codexHome = process.env.CODEX_HOME?.trim() || join(home, '.codex');
const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude');
// ... hermes/autohand/grok/sarvam 等同样有 _HOME env 覆盖

codex: {
  name: 'codex',
  displayName: 'Codex',
  skillsDir: '.agents/skills',
  globalSkillsDir: join(home, '.agents', 'skills'),
  detectInstalled: async () => {
    return existsSync(codexHome) || existsSync('/etc/codex');
  },
},
```

要点：Codex 的项目路径与全局路径都是 `.agents/skills`；`CODEX_HOME` 仅用于检测安装，不改变 skills 目录。

## 上游锁文件

- 全局锁（src/skill-lock.ts:63-72）：`$XDG_STATE_HOME/skills/.skill-lock.json`，否则 `~/.agents/.skill-lock.json`。
- 项目锁（src/local-lock.ts:5）：`skills-lock.json`，entry 带「Package whose package.json `skills` field requested the skill; `.` is the project」归因字段（byPackage）。

## sync 命令（src/sync.ts，v1.7.1–v1.7.2 新增 647 行）

`SyncOptions { agent, yes, copy, dryRun, cleanup, include, exclude, remote, recursive }`。
过滤语法：「`<package>` matches every skill of a package, `<package>#<skill>` one of them. Both parts are globs.」
v1.7.0...v1.7.2 共 48 个 commit、37 文件、+3136/-618；最大新增 tests/sync.test.ts（934 行）。
README（main）检索不到任何 sync 章节，可见功能先于文档。

## README（main）命令面与安全叙述

- `skills use <source>`：免安装试用，写临时目录、生成 prompt，`| claude` 或 `--agent` 交互启动。
- 来源：GitHub shorthand/URL/tree 子路径、GitLab、Azure DevOps `_git/`、任意 git URL、本地路径、直接归档 URL（.zip/.tar/.tgz/单个 SKILL.md）。
- 直接 URL 下载限制：10 MiB 下载 / 25 MiB 解压 / 1000 文件，env 可覆盖（SKILLS_DOWNLOAD_MAX_BYTES 等）。**该限制是为任意 URL 来源设计的**。
- 私有仓库认证链：git credential helper → `gh repo clone` → SSH；明确「不执行 `gh auth token`、不把凭据复制进 Node 进程」；tree 查询匿名 API → env token → `gh api`。
- Supported Agents 表：75+ agents；Cline、Codex、Cursor、Droid、Pi 等 universal agents 均为 `.agents/skills/`（项目）与 `~/.agents/skills/`（全局）。

## 运行时实证：codeload 接受 SHA 作为 ref

```
SHA=671e8c320810d36fed80fac5f1a2c1bf7e82d812（v1.7.2 的 commit）
curl -sI https://codeload.github.com/vercel-labs/skills/zip/$SHA
→ HTTP/2 200, content-disposition: attachment; filename=skills-671e8c3….zip
```

即我方现有「按 ref 拼 codeload zip URL」的管线无需改动即可按 SHA 下载。
