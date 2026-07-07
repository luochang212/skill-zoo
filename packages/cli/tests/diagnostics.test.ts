import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { archiveSkillRefs } from "../src/protocol/archive.js";
import { fixDoctor, runDoctor } from "../src/protocol/diagnostics.js";
import { getPaths } from "../src/protocol/paths.js";
import { rebuildCache } from "../src/protocol/scan.js";
import { readArchiveManifest, readCache } from "../src/protocol/store.js";
import { isSymlinkOrJunction, normalizePath, pathsEqual } from "../src/lib/io.js";
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
        expected: normalizePath(skillDir),
      }),
    );
  });

  it("leaves same-named real agent directories to consistency checks", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");
    await writeSkill(path.join(home, ".codex", "skills", "demo"), "name: Demo");
    await rebuildCache(home);

    const report = await runDoctor(home);

    expect(report.status).toBe("ok");
    expect(report.checks).not.toContainEqual(
      expect.objectContaining({
        id: "agent-link",
        message: expect.stringContaining("not a symlink"),
      }),
    );
  });

  it("warns instead of repairing when multiple skills contest one agent link path", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const ssotSkill = path.join(paths.agentsSkillsDir, "demo");
    const codexSystemSkill = path.join(home, ".codex", "skills", ".system", "demo");
    const claudeLink = path.join(home, ".claude", "skills", "demo");
    await writeSkill(ssotSkill, "name: Demo");
    await writeSkill(codexSystemSkill, "name: Demo\nsystem: codex");
    await createDirLink(codexSystemSkill, claudeLink);
    await rebuildCache(home);

    const report = await runDoctor(home);

    expect(report.status).toBe("warn");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "contested-agent-link",
        status: "warn",
        path: claudeLink,
      }),
    );
    expect(report.checks).not.toContainEqual(
      expect.objectContaining({
        id: "agent-link",
        status: "error",
        path: claudeLink,
      }),
    );
  });
});

describe("fixDoctor", () => {
  it("dry-runs stale cache repair without writing", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: Demo");

    const result = await fixDoctor(home, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.before.status).toBe("warn");
    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: "rebuild-cache",
        status: "planned",
      }),
    );
    expect((await readCache(home)).skills).toEqual([]);
  });

  it("repairs invalid symlinks and refreshes doctor status", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const skillDir = path.join(paths.agentsSkillsDir, "demo");
    const wrongDir = path.join(home, "wrong-target");
    const codexLink = path.join(home, ".codex", "skills", "demo");
    await writeSkill(skillDir, "name: Demo");
    await fs.mkdir(wrongDir, { recursive: true });
    await createDirLink(wrongDir, codexLink);
    await rebuildCache(home);

    const result = await fixDoctor(home);

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: "replace-link",
        status: "applied",
        path: codexLink,
        target: normalizePath(skillDir),
      }),
    );
    expect(await isSymlinkOrJunction(codexLink)).toBe(true);
    expect(await pathsEqual(codexLink, skillDir)).toBe(true);
    expect(result.after.status).toBe("ok");
  });

  it("does not replace contested agent links", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const ssotSkill = path.join(paths.agentsSkillsDir, "demo");
    const codexSystemSkill = path.join(home, ".codex", "skills", ".system", "demo");
    const claudeLink = path.join(home, ".claude", "skills", "demo");
    await writeSkill(ssotSkill, "name: Demo");
    await writeSkill(codexSystemSkill, "name: Demo\nsystem: codex");
    await createDirLink(codexSystemSkill, claudeLink);
    await rebuildCache(home);

    const result = await fixDoctor(home);

    expect(result.before.status).toBe("warn");
    expect(result.actions).not.toContainEqual(expect.objectContaining({ kind: "replace-link" }));
    expect(await pathsEqual(claudeLink, codexSystemSkill)).toBe(true);
    expect(result.after.status).toBe("warn");
  });
});
