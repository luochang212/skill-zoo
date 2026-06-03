import { Command, Option } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { archiveSkillRefs, listArchivedSkills, restoreArchiveIds } from "./protocol/archive.js";
import {
  inspectArchivedSkill,
  inspectInstalledSkill,
  runDoctor,
  type DoctorReport,
  type InspectSkillData,
} from "./protocol/diagnostics.js";
import { getAllAgentPaths } from "./protocol/paths.js";
import { rebuildCache, scanInstalledSkills } from "./protocol/scan.js";
import { CliError, messageFromError } from "./lib/errors.js";
import {
  formatArchivedList,
  formatSkillList,
  jsonEnvelope,
} from "./output.js";
import { CLI_VERSION } from "./version.js";

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
  Explain:   inspect
  Maintain:  doctor, refresh
  Change:    archive, restore

Common workflows:
  Inspect local state:
    $ skill-zoo doctor --json
    $ skill-zoo inspect <skill-ref> --json

  Archive safely:
    $ skill-zoo archive <skill-ref> --dry-run --json
    $ skill-zoo archive <skill-ref> --yes --json

  Restore safely:
    $ skill-zoo restore <archive-id> --dry-run --json
    $ skill-zoo restore <archive-id> --yes --json

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
    .option("--json", "print machine-readable JSON")
    .action(async (options: CommonOptions & { archived?: boolean }) =>
      withErrors(io, withHome(program, options), async () => {
        const opts = withHome(program, options);
        if (opts.archived) {
          const skills = await listArchivedSkills(opts.home);
          writeSuccess(io, opts, skills, undefined, formatArchivedList(skills));
        } else {
          const skills = await scanInstalledSkills(opts.home);
          writeSuccess(io, opts, skills, undefined, formatSkillList(skills));
        }
      }),
    );

  program
    .command("status")
    .description("Summarize installed and archived skill counts")
    .option("--refresh", "rebuild skills-cache.json before summarizing")
    .option("--json", "print machine-readable JSON")
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
