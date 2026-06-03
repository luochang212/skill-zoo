import { promises as fs } from "node:fs";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { getPaths } from "../src/protocol/paths.js";
import { archiveSkillRefs } from "../src/protocol/archive.js";
import { readArchiveManifest, readCache } from "../src/protocol/store.js";
import { createDirLink, makeTempHome, writeSkill } from "./helpers.js";
import path from "node:path";

class CaptureStream extends Writable {
  chunks: Buffer[] = [];

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }

  toString() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

describe("CLI output", () => {
  it("prints JSON envelopes", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "code-audit"), "name: Code Audit");
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    await runCli(["--home", home, "list", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    expect(stderr.toString()).toBe("");
    const payload = JSON.parse(stdout.toString()) as { ok: boolean; data: unknown[] };
    expect(payload.ok).toBe(true);
    expect(payload.data).toHaveLength(1);
  });

  it("marks batch JSON output as not ok when every item fails", async () => {
    const home = await makeTempHome();
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    process.exitCode = undefined;

    await runCli(["--home", home, "archive", "missing-skill", "--yes", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    const payload = JSON.parse(stdout.toString()) as {
      ok: boolean;
      data: { failed: { ref: string; error: string }[] };
    };
    expect(stderr.toString()).toBe("");
    expect(payload.ok).toBe(false);
    expect(payload.data.failed[0]?.ref).toBe("missing-skill");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("uses explicit dry-run field names for archive JSON", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    await runCli(["--home", home, "archive", "demo", "--dry-run", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    const payload = JSON.parse(stdout.toString()) as {
      ok: boolean;
      data: { dryRun: boolean; wouldArchive: string[]; archived?: string[] };
    };
    expect(stderr.toString()).toBe("");
    expect(payload.ok).toBe(true);
    expect(payload.data.dryRun).toBe(true);
    expect(payload.data.wouldArchive).toEqual(["ssot:demo"]);
    expect(payload.data.archived).toBeUndefined();
  });

  it("refreshes the filesystem cache", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    await runCli(["--home", home, "refresh", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    const payload = JSON.parse(stdout.toString()) as {
      ok: boolean;
      data: { installedCount: number; refreshed: boolean };
    };
    expect(stderr.toString()).toBe("");
    expect(payload.ok).toBe(true);
    expect(payload.data).toEqual({ installedCount: 1, refreshed: true });
    expect((await readCache(home)).skills).toHaveLength(1);
  });

  it("inspects installed skills as a stable JSON object", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const skillDir = path.join(paths.agentsSkillsDir, "demo");
    const codexLink = path.join(home, ".codex", "skills", "demo");
    await writeSkill(skillDir, "name: Demo\ndescription: Demo skill");
    await fs.mkdir(path.dirname(codexLink), { recursive: true });
    await createDirLink(skillDir, codexLink);
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    await runCli(["--home", home, "inspect", "demo", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    const payload = JSON.parse(stdout.toString()) as {
      ok: boolean;
      data: {
        kind: string;
        id: string;
        name: string;
        directory: string;
        apps: Record<string, boolean>;
        source: Record<string, unknown>;
      };
    };
    expect(stderr.toString()).toBe("");
    expect(payload.ok).toBe(true);
    expect(payload.data).toMatchObject({
      kind: "installed",
      id: "ssot:demo",
      name: "demo",
      directory: "demo",
      source: { repoOwner: null, repoName: null, sourceUrl: null },
    });
    expect(payload.data.apps.codex).toBe(true);
  });

  it("inspects archived skills by archive id", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");
    await archiveSkillRefs(home, ["demo"]);
    const archiveId = Object.keys((await readArchiveManifest(home)).skills)[0];
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    await runCli(["--home", home, "inspect", archiveId!, "--archived", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    const payload = JSON.parse(stdout.toString()) as {
      ok: boolean;
      data: { kind: string; archiveId: string; originalSkillId: string };
    };
    expect(stderr.toString()).toBe("");
    expect(payload.ok).toBe(true);
    expect(payload.data.kind).toBe("archived");
    expect(payload.data.archiveId).toBe(archiveId);
    expect(payload.data.originalSkillId).toBe("ssot:demo");
  });

  it("reports ambiguous inspect refs with a non-zero exit code", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");
    await writeSkill(path.join(home, ".codex", "skills", "demo"), "name: Demo");
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    process.exitCode = undefined;

    await runCli(["--home", home, "inspect", "demo", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    const payload = JSON.parse(stdout.toString()) as { ok: boolean; error: string };
    expect(stderr.toString()).toBe("");
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("ambiguous");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("keeps doctor warnings successful for automation", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    process.exitCode = undefined;

    await runCli(["--home", home, "doctor", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    const payload = JSON.parse(stdout.toString()) as { ok: boolean; data: { status: string } };
    expect(stderr.toString()).toBe("");
    expect(payload.ok).toBe(true);
    expect(payload.data.status).toBe("warn");
    expect(process.exitCode).toBeUndefined();
  });

  it("marks doctor errors as failed for automation", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");
    await archiveSkillRefs(home, ["demo"]);
    const archiveId = Object.keys((await readArchiveManifest(home)).skills)[0];
    await fs.rm(path.join(paths.archiveSkillsDir, archiveId!), { recursive: true, force: true });
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    process.exitCode = undefined;

    await runCli(["--home", home, "doctor", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    const payload = JSON.parse(stdout.toString()) as { ok: boolean; data: { status: string } };
    expect(stderr.toString()).toBe("");
    expect(payload.ok).toBe(false);
    expect(payload.data.status).toBe("error");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("dry-runs doctor fix as a successful JSON command", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    process.exitCode = undefined;

    await runCli(["--home", home, "doctor", "fix", "--dry-run", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    const payload = JSON.parse(stdout.toString()) as {
      ok: boolean;
      data: { dryRun: boolean; actions: { kind: string; status: string }[] };
    };
    expect(stderr.toString()).toBe("");
    expect(payload.ok).toBe(true);
    expect(payload.data.dryRun).toBe(true);
    expect(payload.data.actions).toContainEqual(
      expect.objectContaining({ kind: "rebuild-cache", status: "planned" }),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("refuses doctor fix writes without confirmation in non-interactive shells", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    process.exitCode = undefined;

    await runCli(["--home", home, "doctor", "fix", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    const payload = JSON.parse(stdout.toString()) as { ok: boolean; error: string };
    expect(stderr.toString()).toBe("");
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("Refusing to write without --yes");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("reports consistency warnings without failing automation", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    process.exitCode = undefined;

    await runCli(["--home", home, "consistency", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    const payload = JSON.parse(stdout.toString()) as {
      ok: boolean;
      data: { status: string; summary: { mismatch: number } };
    };
    expect(stderr.toString()).toBe("");
    expect(payload.ok).toBe(true);
    expect(payload.data.status).toBe("warn");
    expect(payload.data.summary.mismatch).toBe(1);
    expect(process.exitCode).toBeUndefined();
  });
});
