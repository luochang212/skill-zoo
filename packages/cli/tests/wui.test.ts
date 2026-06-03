import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProgram } from "../src/cli.js";
import { pathExists } from "../src/lib/io.js";
import { getPaths } from "../src/protocol/paths.js";
import { readArchiveManifest } from "../src/protocol/store.js";
import { parseWuiPort, startWuiServer, type WuiServerHandle } from "../src/wui/server.js";
import { makeTempHome, writeSkill } from "./helpers.js";

describe("wui command", () => {
  it("documents the local Web UI command", () => {
    const program = createProgram();
    const help = program.helpInformation();
    const command = program.commands.find((item) => item.name() === "wui");

    expect(help).toContain("wui");
    expect(command?.helpInformation()).toContain("--port <number>");
    expect(command?.helpInformation()).toContain("--no-open");
  });

  it("validates port values", () => {
    expect(parseWuiPort("8280")).toBe(8280);
    expect(() => parseWuiPort("0")).toThrow("Invalid port");
    expect(() => parseWuiPort("abc")).toThrow("Invalid port");
    expect(() => parseWuiPort("70000")).toThrow("Invalid port");
  });
});

describe("wui server", () => {
  it("requires the session token for API calls", async () => {
    const handle = await startWuiServer({ port: 0, token: "test-token" });
    try {
      const response = await fetch(`${origin(handle)}/api/state`);
      const payload = await response.json() as { ok: boolean; error: string };

      expect(response.status).toBe(401);
      expect(payload.ok).toBe(false);
      expect(payload.error).toBe("Unauthorized");
    } finally {
      await handle.close();
    }
  });

  it("reads local state from the configured home", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo\ndescription: Demo skill");
    const handle = await startWuiServer({ home, port: 0, token: "test-token" });
    try {
      const payload = await getJson<{
        ok: boolean;
        data: {
          installed: unknown[];
          consistency: { status: string; summary: { total: number } };
          status: { installedCount: number; consistencyStatus: string };
        };
      }>(handle, "/api/state");

      expect(payload.ok).toBe(true);
      expect(payload.data.status.installedCount).toBe(1);
      expect(payload.data.status.consistencyStatus).toBe("warn");
      expect(payload.data.consistency.summary.total).toBe(1);
      expect(payload.data.installed).toHaveLength(1);
    } finally {
      await handle.close();
    }
  });

  it("serves installed skill markdown content", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");
    const handle = await startWuiServer({ home, port: 0, token: "test-token" });
    try {
      const payload = await getJson<{ ok: boolean; data: { content: string } }>(
        handle,
        "/api/content?kind=installed&ref=ssot%3Ademo",
      );

      expect(payload.ok).toBe(true);
      expect(payload.data.content).toContain("# Skill");
    } finally {
      await handle.close();
    }
  });

  it("serves consistency reports", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");
    const handle = await startWuiServer({ home, port: 0, token: "test-token" });
    try {
      const payload = await getJson<{
        ok: boolean;
        data: { status: string; summary: { mismatch: number } };
      }>(handle, "/api/consistency");

      expect(payload.ok).toBe(true);
      expect(payload.data.status).toBe("warn");
      expect(payload.data.summary.mismatch).toBe(1);
    } finally {
      await handle.close();
    }
  });

  it("dry-runs doctor fix through the WUI API", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");
    const handle = await startWuiServer({ home, port: 0, token: "test-token" });
    try {
      const payload = await postJson<{
        ok: boolean;
        data: { dryRun: boolean; actions: { kind: string; status: string }[] };
      }>(handle, "/api/doctor/fix", { dryRun: true });

      expect(payload.ok).toBe(true);
      expect(payload.data.dryRun).toBe(true);
      expect(payload.data.actions).toContainEqual(
        expect.objectContaining({ kind: "rebuild-cache", status: "planned" }),
      );
    } finally {
      await handle.close();
    }
  });

  it("dry-runs archive without mutating, then executes archive", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const skillDir = path.join(paths.agentsSkillsDir, "demo");
    await writeSkill(skillDir, "name: Demo");
    const handle = await startWuiServer({ home, port: 0, token: "test-token" });
    try {
      const preview = await postJson<{
        ok: boolean;
        data: { wouldArchive: string[] };
        changes: unknown[];
      }>(handle, "/api/archive", { refs: ["ssot:demo"], dryRun: true });

      expect(preview.ok).toBe(true);
      expect(preview.data.wouldArchive).toEqual(["ssot:demo"]);
      expect(preview.changes.length).toBeGreaterThan(0);
      expect(await pathExists(skillDir)).toBe(true);

      const execute = await postJson<{ ok: boolean }>(handle, "/api/archive", {
        refs: ["ssot:demo"],
        dryRun: false,
      });

      expect(execute.ok).toBe(true);
      expect(await pathExists(skillDir)).toBe(false);
      expect(Object.keys((await readArchiveManifest(home)).skills)).toHaveLength(1);
    } finally {
      await handle.close();
    }
  });

  it("fails clearly when the requested port is occupied", async () => {
    const first = await startWuiServer({ port: 0, token: "test-token" });
    try {
      await expect(startWuiServer({ port: first.port, token: "other-token" })).rejects.toThrow(
        `Port ${first.port} is already in use`,
      );
    } finally {
      await first.close();
    }
  });
});

function origin(handle: WuiServerHandle): string {
  return `http://127.0.0.1:${handle.port}`;
}

async function getJson<T>(handle: WuiServerHandle, pathName: string): Promise<T> {
  const response = await fetch(`${origin(handle)}${pathName}`, {
    headers: { "x-skill-zoo-token": handle.token },
  });
  return response.json() as Promise<T>;
}

async function postJson<T>(handle: WuiServerHandle, pathName: string, body: unknown): Promise<T> {
  const response = await fetch(`${origin(handle)}${pathName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-skill-zoo-token": handle.token,
    },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<T>;
}
