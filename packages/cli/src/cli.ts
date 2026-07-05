import { Command, Option } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { archiveSkillRefs, listArchivedSkills, restoreArchiveIds } from "./protocol/archive.js";
import { runConsistency, type ConsistencyIssueKind, type ConsistencyReport } from "./protocol/consistency.js";
import { readArchivedSkillMd, readInstalledSkillMd } from "./protocol/content.js";
import {
  fixDoctor,
  inspectArchivedSkill,
  inspectInstalledSkill,
  runDoctor,
  type DoctorFixResult,
  type DoctorReport,
  type InspectSkillData,
} from "./protocol/diagnostics.js";
import { AGENTS } from "./protocol/agents.js";
import { getAllAgentPaths } from "./protocol/paths.js";
import { rebuildCache, scanInstalledSkills } from "./protocol/scan.js";
import type { InstalledSkill, SkillOrigin } from "./protocol/types.js";
import type { BatchFailure, Change } from "./protocol/types.js";
import { CliError, messageFromError } from "./lib/errors.js";
import {
  cleanExternalImportLinks,
  importExternalSkills,
  importsBatchExitCode,
  listExternalImports,
  removeExternalImport,
  scanExternalImportFolder,
  type ExternalImportCandidate,
  type ExternalImportInfo,
} from "./protocol/imports.js";
import {
  formatArchivedList,
  formatSkillList,
  jsonEnvelope,
} from "./output.js";
import { CLI_VERSION } from "./version.js";
import {
  DEFAULT_WUI_PORT,
  openBrowser,
  parseWuiPort,
  startWuiServer,
  waitForWuiShutdown,
} from "./wui/server.js";

interface IO {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadableStream;
}

interface GlobalOptions {
  home?: string;
}

interface CommonOptions extends GlobalOptions {
  json?: boolean;
}

interface WriteOptions extends CommonOptions {
  dryRun?: boolean;
  yes?: boolean;
}

interface ListOptions extends CommonOptions {
  archived?: boolean;
  agent?: string;
  origin?: string;
  issue?: string;
}

type ListIssueFilter = ConsistencyIssueKind | "any";

export function createProgram(io: IO = defaultIO()): Command {
  const program = new Command();

  program
    .name("skill-zoo")
    .description("Agent-native CLI for Skill Zoo")
    .version(CLI_VERSION)
    .addOption(new Option("--home <path>", "override the user home directory").hideHelp())
    .addHelpText(
      "after",
      `

Command map:
  Discover:  list, status, paths
  Explain:   inspect, show
  Maintain:  doctor, doctor fix, consistency, refresh
  Change:    archive, restore, imports
  UI:        wui

Common workflows:
  Inspect local state:
    $ skill-zoo status --json
    $ skill-zoo paths
    $ skill-zoo doctor --json
    $ skill-zoo consistency --json
    $ skill-zoo show <skill-ref>
    $ skill-zoo inspect <skill-ref> --json

  Repair low-risk doctor issues:
    $ skill-zoo doctor fix --dry-run --json
    $ skill-zoo doctor fix --yes --json

  Archive safely:
    $ skill-zoo archive <skill-ref> --dry-run --json
    $ skill-zoo archive <skill-ref> --yes --json

  Restore safely:
    $ skill-zoo restore <archive-id> --dry-run --json
    $ skill-zoo restore <archive-id> --yes --json

  Manage external imports:
    $ skill-zoo imports
    $ skill-zoo imports scan ~/private-skills --json
    $ skill-zoo imports add ~/private-skills/utils --dry-run --json
    $ skill-zoo imports add ~/private-skills/utils --yes --json
    $ skill-zoo imports remove external:utils-a1b2c3d4 --dry-run --json
    $ skill-zoo imports clean

  Open local Web UI:
    $ skill-zoo wui

Help:
  $ skill-zoo help <command>
  $ skill-zoo <command> --help

Agent defaults:
  Prefer --json for automation.
  Run write commands with --dry-run first.
  Doctor warnings do not fail automation; errors do.
  The CLI does not notify a running desktop app; refresh or restart the app after writes.
`,
    )
    .configureOutput({
      writeOut: (value) => io.stdout.write(value),
      writeErr: (value) => io.stderr.write(value),
    });

  program
    .command("list")
    .description("Discover installed skills")
    .option("--archived", "show archived skills instead")
    .option("--agent <id>", "filter installed skills enabled for an agent")
    .option("--origin <origin>", "filter installed skills by origin: ssot or agent")
    .option("--issue <kind>", "filter installed skills by consistency issue: any, duplicate, conflict, or mismatch")
    .option("--json", "print machine-readable JSON")
    .addHelpText(
      "after",
      `

Installed filters:
  $ skill-zoo list --agent codex
  $ skill-zoo list --origin ssot
  $ skill-zoo list --issue conflict

Archived skills:
  $ skill-zoo list --archived
`,
    )
    .action(async (options: ListOptions) =>
      withErrors(io, withHome(program, options), async () => {
        const opts = withHome(program, options);
        if (opts.archived) {
          assertNoInstalledListFilters(opts);
          const skills = await listArchivedSkills(opts.home);
          writeSuccess(io, opts, skills, undefined, formatArchivedList(skills));
        } else {
          const skills = await filterInstalledSkills(opts.home, await scanInstalledSkills(opts.home), opts);
          writeSuccess(io, opts, skills, undefined, formatSkillList(skills));
        }
      }),
    );

  program
    .command("status")
    .description("Summarize installed and archived skill counts")
    .option("--refresh", "rebuild skills-cache.json before summarizing")
    .option("--json", "print machine-readable JSON")
    .addHelpText(
      "after",
      `

Examples:
  $ skill-zoo status
  $ skill-zoo status --refresh --json
`,
    )
    .action(async (options: CommonOptions & { refresh?: boolean }) =>
      withErrors(io, withHome(program, options), async () => {
        const opts = withHome(program, options);
        const installed = opts.refresh ? await rebuildCache(opts.home) : await scanInstalledSkills(opts.home);
        const archived = await listArchivedSkills(opts.home);
        const data = {
          installedCount: installed.length,
          archivedCount: archived.length,
          refreshed: Boolean(opts.refresh),
        };
        writeSuccess(
          io,
          opts,
          data,
          undefined,
          `Installed: ${data.installedCount}\nArchived: ${data.archivedCount}\n`,
        );
      }),
    );

  program
    .command("refresh")
    .description("Rebuild the local skill cache")
    .option("--json", "print machine-readable JSON")
    .addHelpText(
      "after",
      `

Examples:
  $ skill-zoo refresh
  $ skill-zoo refresh --json
`,
    )
    .action(async (options: CommonOptions) =>
      withErrors(io, withHome(program, options), async () => {
        const opts = withHome(program, options);
        const installed = await rebuildCache(opts.home);
        const data = {
          installedCount: installed.length,
          refreshed: true,
        };
        writeSuccess(io, opts, data, undefined, `Refreshed ${data.installedCount} installed skill(s).\n`);
      }),
    );

  program
    .command("paths")
    .description("Show Skill Zoo and agent filesystem paths")
    .option("--json", "print machine-readable JSON")
    .addHelpText(
      "after",
      `

Examples:
  $ skill-zoo paths
  $ skill-zoo paths --json
`,
    )
    .action(async (options: CommonOptions) =>
      withErrors(io, withHome(program, options), async () => {
        const opts = withHome(program, options);
        const paths = getAllAgentPaths(opts.home);
        writeSuccess(
          io,
          opts,
          paths,
          undefined,
          `${paths.map((item) => `${item.agent}: ${item.path}`).join("\n")}\n`,
        );
      }),
    );

  program
    .command("inspect")
    .description("Explain one installed or archived skill")
    .argument("<skill-ref>", "installed skill id/directory/name, or archive id with --archived")
    .option("--archived", "inspect an archived skill by archive id")
    .option("--json", "print machine-readable JSON")
    .addHelpText(
      "after",
      `

Examples:
  $ skill-zoo inspect code-audit
  $ skill-zoo inspect code-audit-a1b2c3d4 --archived --json
`,
    )
    .action(async (ref: string, options: CommonOptions & { archived?: boolean }) =>
      withErrors(io, withHome(program, options), async () => {
        const opts = withHome(program, options);
        const data = opts.archived
          ? await inspectArchivedSkill(opts.home, ref)
          : await inspectInstalledSkill(opts.home, ref);
        writeSuccess(io, opts, data, undefined, formatInspect(data));
      }),
    );

  program
    .command("show")
    .description("Print one skill's SKILL.md")
    .argument("<skill-ref>", "installed skill id/directory/name, or archive id with --archived")
    .option("--archived", "show an archived skill by archive id")
    .option("--json", "print machine-readable JSON")
    .addHelpText(
      "after",
      `

Examples:
  $ skill-zoo show code-audit
  $ skill-zoo show code-audit-a1b2c3d4 --archived
`,
    )
    .action(async (ref: string, options: CommonOptions & { archived?: boolean }) =>
      withErrors(io, withHome(program, options), async () => {
        const opts = withHome(program, options);
        const content = opts.archived
          ? await readArchivedSkillMd(opts.home, ref)
          : await readInstalledSkillMd(opts.home, ref);
        writeSuccess(io, opts, { archived: Boolean(opts.archived), ref, content }, undefined, content);
      }),
    );

  const doctorCommand = program
    .command("doctor")
    .description("Diagnose local Skill Zoo state")
    .option("--json", "print machine-readable JSON")
    .action(async (options: CommonOptions) =>
      withErrors(io, withHome(program, options), async () => {
        const opts = withHome(program, options);
        const report = await runDoctor(opts.home);
        writeResult(io, opts, report.status !== "error", report, undefined, formatDoctor(report));
        if (report.status === "error") {
          process.exitCode = 1;
        }
      }),
    );

  doctorCommand
    .command("fix")
    .description("Repair low-risk doctor issues")
    .option("--dry-run", "show changes without writing")
    .option("--yes", "skip confirmation")
    .option("--json", "print machine-readable JSON")
    .addHelpText(
      "after",
      `

Safe workflow:
  $ skill-zoo doctor fix --dry-run --json
  $ skill-zoo doctor fix --yes --json
`,
    )
    .action(async (options: WriteOptions, command: Command) => {
      const parentOptions = (command.parent?.opts() ?? {}) as CommonOptions;
      const localOptions: WriteOptions = {
        ...options,
        json: options.json ?? parentOptions.json,
      };
      return withErrors(io, withHome(program, localOptions), async () => {
        const opts = withHome(program, localOptions);
        await requireConfirmation(io, opts, "Repair low-risk doctor issues?");
        const result = await fixDoctor(opts.home, { dryRun: opts.dryRun });
        const failed = result.actions.some((action) => action.status === "failed");
        const ok = !failed && (opts.dryRun || result.after.status !== "error");
        writeResult(io, opts, ok, result, undefined, formatDoctorFix(result));
        if (!ok) {
          process.exitCode = failed ? 1 : 2;
        }
      });
    });

  program
    .command("consistency")
    .description("Report skill content and naming consistency issues")
    .option("--json", "print machine-readable JSON")
    .addHelpText(
      "after",
      `

Examples:
  $ skill-zoo consistency
  $ skill-zoo consistency --json
`,
    )
    .action(async (options: CommonOptions) =>
      withErrors(io, withHome(program, options), async () => {
        const opts = withHome(program, options);
        const report = await runConsistency(opts.home);
        writeSuccess(io, opts, report, undefined, formatConsistency(report));
      }),
    );

  program
    .command("archive")
    .description("Move installed skills into Skill Zoo archive")
    .argument("<skill-ref...>", "skill id, directory, or name")
    .option("--dry-run", "show changes without writing")
    .option("--yes", "skip confirmation")
    .option("--json", "print machine-readable JSON")
    .addHelpText(
      "after",
      `

Safe workflow:
  $ skill-zoo archive code-audit --dry-run --json
  $ skill-zoo archive code-audit --yes --json
`,
    )
    .action(async (refs: string[], options: WriteOptions) =>
      withErrors(io, withHome(program, options), async () => {
        const opts = withHome(program, options);
        await requireConfirmation(io, opts, `Archive ${refs.length} skill(s)?`);
        const result = await archiveSkillRefs(opts.home, refs, { dryRun: opts.dryRun });
        const exitCode = result.failed.length > 0 && result.archived.length > 0 ? 2 : result.failed.length > 0 ? 1 : 0;
        writeResult(
          io,
          opts,
          exitCode === 0,
          formatArchiveData(result, Boolean(opts.dryRun)),
          result.changes,
          formatBatch(opts.dryRun ? "Would archive" : "Archived", result.archived, result.failed),
        );
        if (exitCode !== 0) {
          process.exitCode = exitCode;
        }
      }),
    );

  program
    .command("restore")
    .description("Move archived skills back into active skill directories")
    .argument("<archive-id...>", "archive ids")
    .option("--dry-run", "show changes without writing")
    .option("--yes", "skip confirmation")
    .option("--json", "print machine-readable JSON")
    .addHelpText(
      "after",
      `

Safe workflow:
  $ skill-zoo restore code-audit-a1b2c3d4 --dry-run --json
  $ skill-zoo restore code-audit-a1b2c3d4 --yes --json
`,
    )
    .action(async (archiveIds: string[], options: WriteOptions) =>
      withErrors(io, withHome(program, options), async () => {
        const opts = withHome(program, options);
        await requireConfirmation(io, opts, `Restore ${archiveIds.length} archived skill(s)?`);
        const result = await restoreArchiveIds(opts.home, archiveIds, { dryRun: opts.dryRun });
        const exitCode = result.failed.length > 0 && result.restored.length > 0 ? 2 : result.failed.length > 0 ? 1 : 0;
        writeResult(
          io,
          opts,
          exitCode === 0,
          formatRestoreData(result, Boolean(opts.dryRun)),
          result.changes,
          formatBatch(opts.dryRun ? "Would restore" : "Restored", result.restored, result.failed),
        );
        if (exitCode !== 0) {
          process.exitCode = exitCode;
        }
      }),
    );

  const importsCommand = program
    .command("imports")
    .description("Manage external skill imports")
    .option("--json", "print machine-readable JSON")
    .addHelpText(
      "after",
      `

List external imports:
  $ skill-zoo imports
  $ skill-zoo imports --json

Manage external imports:
  $ skill-zoo imports scan ~/private-skills
  $ skill-zoo imports add ~/private-skills/utils --agent claude-code --dry-run --json
  $ skill-zoo imports remove external:utils-a1b2c3d4 --dry-run --json
  $ skill-zoo imports clean
`,
    )
    .action(async (options: CommonOptions) =>
      withErrors(io, withHome(program, options), async () => {
        const opts = withHome(program, options);
        const imports = await listExternalImports(opts.home);
        writeSuccess(io, opts, imports, undefined, formatImportList(imports));
      }),
    );

  importsCommand
    .command("scan")
    .description("Scan a folder for importable skills")
    .argument("<path>", "folder to scan for skills")
    .option("--json", "print machine-readable JSON")
    .addHelpText(
      "after",
      `

Examples:
  $ skill-zoo imports scan ~/private-skills
  $ skill-zoo imports scan ~/private-skills --json
`,
    )
    .action(async (folderPath: string, options: CommonOptions, command: Command) => {
      const parentOptions = (command.parent?.opts() ?? {}) as CommonOptions;
      const localOptions: CommonOptions = { ...options, json: options.json ?? parentOptions.json };
      return withErrors(io, withHome(program, localOptions), async () => {
        const opts = withHome(program, localOptions);
        const candidates = await scanExternalImportFolder(opts.home, folderPath);
        writeSuccess(io, opts, candidates, undefined, formatScanResults(candidates));
      });
    });

  importsCommand
    .command("add")
    .description("Import external skills as symlinks")
    .argument("<path...>", "paths to skill directories")
    .option("--agent <id...>", "target agents (default: all)")
    .option("--dry-run", "show changes without writing")
    .option("--yes", "skip confirmation")
    .option("--json", "print machine-readable JSON")
    .addHelpText(
      "after",
      `

Safe workflow:
  $ skill-zoo imports add ~/private-skills/utils --dry-run --json
  $ skill-zoo imports add ~/private-skills/utils --yes --json

Target specific agents:
  $ skill-zoo imports add ~/private-skills/utils --agent claude-code --agent codex --yes --json
`,
    )
    .action(async (paths: string[], options: WriteOptions & { agent?: string[] }, command: Command) => {
      const parentOptions = (command.parent?.opts() ?? {}) as CommonOptions;
      const localOptions: WriteOptions & { agent?: string[] } = {
        ...options,
        json: options.json ?? parentOptions.json,
      };
      return withErrors(io, withHome(program, localOptions), async () => {
        const opts = withHome(program, localOptions);
        const agents = validateAgentSelections(opts.agent);
        await requireConfirmation(io, opts, `Import ${paths.length} external skill(s)?`);
        const result = await importExternalSkills(opts.home, paths, agents, { dryRun: opts.dryRun });
        const exitCode = importsBatchExitCode(result.added, result.failed);
        writeResult(
          io,
          opts,
          exitCode === 0,
          formatAddData(result, Boolean(opts.dryRun)),
          result.changes,
          formatBatch(opts.dryRun ? "Would import" : "Imported", result.added, result.failed),
        );
        if (exitCode !== 0) {
          process.exitCode = exitCode;
        }
      });
    });

  importsCommand
    .command("remove")
    .description("Remove external imports (source files are left untouched)")
    .argument("<id...>", "external import ids")
    .option("--dry-run", "show changes without writing")
    .option("--yes", "skip confirmation")
    .option("--json", "print machine-readable JSON")
    .addHelpText(
      "after",
      `

Safe workflow:
  $ skill-zoo imports remove external:utils-a1b2c3d4 --dry-run --json
  $ skill-zoo imports remove external:utils-a1b2c3d4 --yes --json
`,
    )
    .action(async (ids: string[], options: WriteOptions, command: Command) => {
      const parentOptions = (command.parent?.opts() ?? {}) as CommonOptions;
      const localOptions: WriteOptions = { ...options, json: options.json ?? parentOptions.json };
      return withErrors(io, withHome(program, localOptions), async () => {
        const opts = withHome(program, localOptions);
        await requireConfirmation(io, opts, `Remove ${ids.length} external import(s)?`);
        const removed: string[] = [];
        const failed: BatchFailure[] = [];
        const changes: Change[] = [];
        for (const id of ids) {
          try {
            const result = await removeExternalImport(opts.home, id, { dryRun: opts.dryRun });
            removed.push(...result.removed);
            failed.push(...result.failed);
            changes.push(...result.changes);
          } catch (error) {
            failed.push({ ref: id, error: error instanceof Error ? error.message : String(error) });
          }
        }
        const exitCode = importsBatchExitCode(removed, failed);
        writeResult(
          io,
          opts,
          exitCode === 0,
          { removed, failed },
          changes,
          formatBatch(opts.dryRun ? "Would remove" : "Removed", removed, failed),
        );
        if (exitCode !== 0) {
          process.exitCode = exitCode;
        }
      });
    });

  importsCommand
    .command("clean")
    .description("Remove stale symlinks for invalid external imports")
    .argument("[id]", "optional: clean only this import")
    .option("--dry-run", "show changes without writing")
    .option("--yes", "skip confirmation")
    .option("--json", "print machine-readable JSON")
    .addHelpText(
      "after",
      `

Examples:
  $ skill-zoo imports clean --dry-run --json
  $ skill-zoo imports clean --yes --json
  $ skill-zoo imports clean external:utils-a1b2c3d4 --yes --json
`,
    )
    .action(async (id: string | undefined, options: WriteOptions, command: Command) => {
      const parentOptions = (command.parent?.opts() ?? {}) as CommonOptions;
      const localOptions: WriteOptions = { ...options, json: options.json ?? parentOptions.json };
      return withErrors(io, withHome(program, localOptions), async () => {
        const opts = withHome(program, localOptions);
        await requireConfirmation(io, opts, "Clean stale external import links?");
        const result = await cleanExternalImportLinks(opts.home, id, { dryRun: opts.dryRun });
        const exitCode = importsBatchExitCode(result.cleaned, result.failed);
        writeResult(
          io,
          opts,
          exitCode === 0,
          result,
          result.changes,
          formatBatch(opts.dryRun ? "Would clean" : "Cleaned", result.cleaned, result.failed),
        );
        if (exitCode !== 0) {
          process.exitCode = exitCode;
        }
      });
    });

  program
    .command("wui")
    .description("Start the lightweight local Web UI")
    .option("--port <number>", "port to listen on", parseWuiPort, DEFAULT_WUI_PORT)
    .option("--no-open", "print the URL without opening a browser")
    .addHelpText(
      "after",
      `

Examples:
  $ skill-zoo wui
  $ skill-zoo wui --port 8281 --no-open
`,
    )
    .action(async (options: GlobalOptions & { port: number; open?: boolean }) =>
      withErrors(io, withHome(program, options), async () => {
        const opts = withHome(program, options);
        const handle = await startWuiServer({ home: opts.home, port: opts.port });
        io.stdout.write(`Skill Zoo WUI: ${handle.url}\n`);
        if (opts.open !== false) {
          openBrowser(handle.url);
        }
        await waitForWuiShutdown(handle.server);
      }),
    );

  return program;
}

function withHome<T extends CommonOptions>(program: Command, options: T): T {
  return {
    ...options,
    home: options.home ?? (program.opts() as GlobalOptions).home,
  };
}

export async function runCli(argv: string[], io: IO = defaultIO()): Promise<void> {
  const program = createProgram(io);
  await program.parseAsync(argv, { from: "user" });
}

function defaultIO(): IO {
  return {
    stdout: defaultStdout,
    stderr: process.stderr,
    stdin: defaultStdin,
  };
}

async function filterInstalledSkills(
  home: string | undefined,
  skills: InstalledSkill[],
  options: ListOptions,
): Promise<InstalledSkill[]> {
  let filtered = skills;

  if (options.agent) {
    const agent = validateAgentFilter(options.agent);
    filtered = filtered.filter((skill) => skill.apps[agent] === true);
  }

  if (options.origin) {
    const origin = validateOriginFilter(options.origin);
    filtered = filtered.filter((skill) => skill.origin === origin);
  }

  if (options.issue) {
    const issue = validateIssueFilter(options.issue);
    const report = await runConsistency(home);
    const issueSkillIds = new Set(
      report.issues
        .filter((item) => issue === "any" || item.kind === issue)
        .flatMap((item) => item.skills.map((skill) => skill.id)),
    );
    filtered = filtered.filter((skill) => issueSkillIds.has(skill.id));
  }

  return filtered;
}

function assertNoInstalledListFilters(options: ListOptions): void {
  if (options.agent || options.origin || options.issue) {
    throw new CliError("List filters --agent, --origin, and --issue are only supported for installed skills.");
  }
}

function validateAgentFilter(agent: string): string {
  if (!AGENTS.some((item) => item.id === agent)) {
    throw new CliError(`Unknown agent: ${agent}. Expected one of: ${AGENTS.map((item) => item.id).join(", ")}`);
  }
  return agent;
}

function validateOriginFilter(origin: string): SkillOrigin {
  if (origin !== "ssot" && origin !== "agent" && origin !== "external") {
    throw new CliError(`Invalid origin: ${origin}. Expected ssot, agent, or external.`);
  }
  return origin;
}

function validateIssueFilter(issue: string): ListIssueFilter {
  if (issue !== "any" && issue !== "duplicate" && issue !== "conflict" && issue !== "mismatch") {
    throw new CliError(`Invalid issue filter: ${issue}. Expected any, duplicate, conflict, or mismatch.`);
  }
  return issue;
}

async function withErrors(
  io: IO,
  options: CommonOptions,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = messageFromError(error);
    if (options.json) {
      io.stdout.write(jsonEnvelope({ ok: false, error: message }));
    } else {
      io.stderr.write(`${message}\n`);
    }
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
  }
}

function writeSuccess(
  io: IO,
  options: CommonOptions,
  data: unknown,
  changes: Parameters<typeof jsonEnvelope>[0]["changes"],
  human: string,
): void {
  writeResult(io, options, true, data, changes, human);
}

function writeResult(
  io: IO,
  options: CommonOptions,
  ok: boolean,
  data: unknown,
  changes: Parameters<typeof jsonEnvelope>[0]["changes"],
  human: string,
): void {
  if (options.json) {
    io.stdout.write(jsonEnvelope({ ok, data, changes }));
  } else {
    io.stdout.write(human);
  }
}

async function requireConfirmation(io: IO, options: WriteOptions, message: string): Promise<void> {
  if (options.dryRun || options.yes) {
    return;
  }

  if (!process.stdin.isTTY) {
    throw new CliError("Refusing to write without --yes in a non-interactive shell.");
  }

  const readline = createInterface({ input: io.stdin, output: io.stdout });
  const answer = await readline.question(`${message} Type yes to continue: `);
  readline.close();
  if (answer.trim().toLowerCase() !== "yes") {
    throw new CliError("Aborted.");
  }
}

function formatBatch(label: string, succeeded: string[], failed: { ref: string; error: string }[]): string {
  const lines: string[] = [];
  if (succeeded.length > 0) {
    lines.push(`${label}: ${succeeded.join(", ")}`);
  }
  if (failed.length > 0) {
    lines.push(`Failed: ${failed.map((item) => `${item.ref}: ${item.error}`).join("; ")}`);
  }
  return `${lines.join("\n") || "No changes."}\n`;
}

function formatInspect(data: InspectSkillData): string {
  const lines = [
    `${data.kind}: ${data.id}`,
    `name: ${data.name}`,
    `directory: ${data.directory}`,
    `origin: ${data.origin}`,
  ];
  if (data.archiveId) {
    lines.push(`archiveId: ${data.archiveId}`);
  }
  if (data.originalSkillId) {
    lines.push(`originalSkillId: ${data.originalSkillId}`);
  }
  if (data.homePath) {
    lines.push(`homePath: ${data.homePath}`);
  }
  if (data.homeAgent) {
    lines.push(`homeAgent: ${data.homeAgent}`);
  }
  const enabledAgents = Object.entries(data.apps)
    .filter(([, enabled]) => enabled)
    .map(([agent]) => agent);
  lines.push(`apps: ${enabledAgents.join(", ") || "(none)"}`);
  if (data.source.sourceUrl) {
    lines.push(`source: ${data.source.sourceUrl}`);
  } else if (data.source.repoOwner && data.source.repoName) {
    lines.push(`source: ${data.source.repoOwner}/${data.source.repoName}`);
  }
  lines.push(`starred: ${data.starred}`);
  lines.push(`isMine: ${data.isMine}`);
  return `${lines.join("\n")}\n`;
}

function formatDoctor(report: DoctorReport): string {
  const checks = report.checks.length === 0
    ? ["ok: No local Skill Zoo state found."]
    : report.checks.map((check) => `${check.status}: ${check.message}`);
  return `Status: ${report.status}\n${checks.join("\n")}\n`;
}

function formatDoctorFix(result: DoctorFixResult): string {
  const lines = [
    `Before: ${result.before.status}`,
    `After: ${result.after.status}`,
  ];
  if (result.actions.length === 0) {
    lines.push("No low-risk fixes available.");
  } else {
    for (const action of result.actions) {
      const target = action.target ? ` -> ${action.target}` : "";
      const suffix = action.error ? ` (${action.error})` : "";
      lines.push(`${action.status}: ${action.kind}: ${action.path ?? "(local state)"}${target}${suffix}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatConsistency(report: ConsistencyReport): string {
  const lines = [
    `Status: ${report.status}`,
    `Issues: ${report.summary.total}`,
    `Duplicates: ${report.summary.duplicate}`,
    `Conflicts: ${report.summary.conflict}`,
    `Mismatches: ${report.summary.mismatch}`,
  ];
  for (const issue of report.issues) {
    lines.push(`${issue.kind}: ${issue.message}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatArchiveData(
  result: Awaited<ReturnType<typeof archiveSkillRefs>>,
  dryRun: boolean,
) {
  if (!dryRun) {
    return result;
  }

  return {
    dryRun: true,
    wouldArchive: result.archived,
    failed: result.failed,
    changes: result.changes,
  };
}

function formatRestoreData(
  result: Awaited<ReturnType<typeof restoreArchiveIds>>,
  dryRun: boolean,
) {
  if (!dryRun) {
    return result;
  }

  return {
    dryRun: true,
    wouldRestore: result.restored,
    failed: result.failed,
    changes: result.changes,
  };
}

function formatImportList(imports: ExternalImportInfo[]): string {
  if (imports.length === 0) {
    return "No external imports found.\n";
  }
  return `${imports
    .map((imp) => {
      const status = imp.status !== "valid" ? ` [${imp.status}]` : "";
      const agents = imp.linkedAgents.length > 0 ? ` [${imp.linkedAgents.join(", ")}]` : "";
      return `${imp.id} ${imp.sourcePath}${status}${agents}`;
    })
    .join("\n")}\n`;
}

function formatScanResults(candidates: ExternalImportCandidate[]): string {
  if (candidates.length === 0) {
    return "No importable skills found.\n";
  }
  return `${candidates
    .map((c) => {
      const imported = c.alreadyImported ? " [already imported]" : "";
      return `${c.sourcePath} (${c.name})${imported}`;
    })
    .join("\n")}\n`;
}

function formatAddData(
  result: Awaited<ReturnType<typeof importExternalSkills>>,
  dryRun: boolean,
) {
  if (!dryRun) {
    return result;
  }
  return {
    dryRun: true,
    wouldImport: result.added,
    failed: result.failed,
    changes: result.changes,
  };
}

function validateAgentSelections(agents?: string[]): string[] {
  if (!agents || agents.length === 0) {
    return AGENTS.map((a) => a.id);
  }
  for (const agent of agents) {
    if (!AGENTS.some((a) => a.id === agent)) {
      throw new CliError(
        `Unknown agent: ${agent}. Expected one of: ${AGENTS.map((a) => a.id).join(", ")}`,
      );
    }
  }
  return agents;
}
