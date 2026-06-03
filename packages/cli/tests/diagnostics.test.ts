import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { archiveSkillRefs } from "../src/protocol/archive.js";
import { runDoctor } from "../src/protocol/diagnostics.js";
import { getPaths } from "../src/protocol/paths.js";
import { rebuildCache } from "../src/protocol/scan.js";
import { readArchiveManifest } from "../src/protocol/store.js";
import { createDirLink, makeTempHome, writeSkill } from "./helpers.js";

describe("runDoctor", () => {
  it("reports ok for a healthy local protocol state", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");
    await rebuildCache(home);

    const report = await runDoctor(home);

    expect(report.status).toBe("ok");
    expect(report.checks).toContainEqual({
      id: "cache-freshness",
      status: "ok",
      message: "Skill cache matches filesystem scan.",
    });
  });

  it("warns when the cache differs from the filesystem scan", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");

    const report = await runDoctor(home);

    expect(report.status).toBe("warn");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "cache-freshness",
        status: "warn",
      }),
    );
  });

  it("warns when a cached skill hash differs from the filesystem scan", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const skillDir = path.join(paths.agentsSkillsDir, "demo");
    await writeSkill(skillDir, "name: Demo");
    await rebuildCache(home);
    await fs.appendFile(path.join(skillDir, "SKILL.md"), "\nChanged content\n");

    const report = await runDoctor(home);

    expect(report.status).toBe("warn");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "cache-freshness",
        status: "warn",
      }),
    );
  });

  it("errors when an archived directory is missing", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");
    await archiveSkillRefs(home, ["demo"]);
    const archiveId = Object.keys((await readArchiveManifest(home)).skills)[0];
    await fs.rm(path.join(paths.archiveSkillsDir, archiveId!), { recursive: true, force: true });

    const report = await runDoctor(home);

    expect(report.status).toBe("error");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "archive-directory",
        status: "error",
        message: `Archived skill directory is missing: ${archiveId}`,
      }),
    );
  });

  it("errors when an agent symlink points at the wrong target", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const skillDir = path.join(paths.agentsSkillsDir, "demo");
    const wrongDir = path.join(home, "wrong-target");
    const codexLink = path.join(home, ".codex", "skills", "demo");
    await writeSkill(skillDir, "name: Demo");
    await fs.mkdir(wrongDir, { recursive: true });
    await createDirLink(wrongDir, codexLink);
    await rebuildCache(home);

    const report = await runDoctor(home);

    expect(report.status).toBe("error");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "agent-link",
        status: "error",
        message: "Agent link points at the wrong target: ssot:demo -> codex",
        path: codexLink,
        expected: skillDir,
      }),
    );
  });
});
