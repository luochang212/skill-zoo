# Skill Zoo CLI

Agent-native command line control surface for Skill Zoo. It reads and writes the same local state as the desktop app; it is not a remote registry or a GUI replacement.

```bash
npm install -g skill-zoo
skill-zoo --help
```

## Command Map

```text
Discover:  list, status, paths
Explain:   inspect
Maintain:  doctor, refresh
Change:    archive, restore
```

## Common Workflows

```bash
skill-zoo doctor
skill-zoo inspect code-audit

skill-zoo archive code-audit --dry-run
skill-zoo archive code-audit --yes

skill-zoo restore code-audit-a1b2c3d4 --dry-run
skill-zoo restore code-audit-a1b2c3d4 --yes
```

Each command supports help:

```bash
skill-zoo help archive
skill-zoo archive --help
```

## References

Installed skills can be referenced by id, directory, or name. If a reference matches more than one installed skill, the command fails instead of guessing.

Archived skills are restored and inspected by archive id, for example `code-audit-a1b2c3d4`.

## Safety

Run `archive` and `restore` with `--dry-run` first. In non-interactive shells, write commands require `--yes`.

`doctor` reports `ok`, `warn`, or `error`. Warnings are advisory; errors should block automation and write operations until resolved.

The CLI does not notify a running desktop app. If the GUI looks stale after CLI changes, run `skill-zoo refresh` or refresh/restart the app.

## Automation

Human output is the default. Add `--json` when another tool or agent needs stable fields such as `ok`, `data`, `changes`, or `error`.

Use `--home <path>` for tests and isolated automation only.

## Local State

The CLI uses these local files and directories:

```text
~/.agents/skills
~/.agents/.skill-lock.json
~/.skill-zoo/metadata.json
~/.skill-zoo/skills-cache.json
~/.skill-zoo/archive/manifest.json
```

Do not edit those protocol files by hand for normal archive or restore tasks.
