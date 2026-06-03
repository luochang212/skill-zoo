import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { getPaths } from "../src/protocol/paths.js";
import { makeTempHome, writeSkill } from "./helpers.js";
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
});
