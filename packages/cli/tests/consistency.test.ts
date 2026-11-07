import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { runConsistency } from "../src/protocol/consistency.js";
import { getPaths } from "../src/protocol/paths.js";
import { makeTempHome, writeJson, writeSkill } from "./helpers.js";

describe("runConsistency", () => {
  it("excludes external imports from duplicate and naming issues", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const sourcePath = path.join(home, "private", "demo");
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: demo");
    await writeSkill(sourcePath, "name: Different Name");
    await writeJson(paths.externalImportsFile, {
      version: 1,
      imports: {
        "external:demo": {
          id: "external:demo",
          directory: "demo",
          sourcePath,
          importedAt: 1,
          updatedAt: 1,
        },
      },
    });

    const report = await runConsistency(home);
    expect(report.issues).toEqual([]);
  });

  it("does not call copies identical when one content hash is unavailable", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: demo");
    const other = path.join(home, ".codex", "skills", "demo");
    await writeSkill(other, "name: demo");
    const deep = path.join(other, ...Array.from({ length: 21 }, () => "nested"));
    await fs.mkdir(deep, { recursive: true });
    await fs.writeFile(path.join(deep, "asset.txt"), "unverified content");

    const report = await runConsistency(home);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]?.skills.some((skill) => !skill.contentHash)).toBe(true);
    expect(report.issues[0]?.kind).toBe("conflict");
  });

  it("reports app-aligned duplicate, conflict, and mismatch issues", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);

    await writeSkill(path.join(paths.agentsSkillsDir, "same"), "name: same\ndescription: Same");
    await writeSkill(path.join(home, ".codex", "skills", "same"), "name: same\ndescription: Same");
    await writeSkill(
      path.join(paths.agentsSkillsDir, "different"),
      "name: different\ndescription: One",
    );
    await writeSkill(
      path.join(home, ".claude", "skills", "different"),
      "name: different\ndescription: Two",
    );
    await writeSkill(path.join(paths.agentsSkillsDir, "folder-name"), "name: Display Name");

    const report = await runConsistency(home);

    expect(report.status).toBe("warn");
    expect(report.summary).toMatchObject({
      total: 3,
      duplicate: 1,
      conflict: 1,
      mismatch: 1,
    });
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        kind: "duplicate",
        name: "same",
        skills: expect.arrayContaining([
          expect.objectContaining({ origin: "ssot", directory: "same" }),
          expect.objectContaining({ origin: "agent", directory: "same", homeAgent: "codex" }),
        ]),
      }),
    );
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        kind: "conflict",
        name: "different",
      }),
    );
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        kind: "mismatch",
        name: "Display Name",
        skills: [expect.objectContaining({ directory: "folder-name", yamlName: "Display Name" })],
      }),
    );
  });

  it("reports ok when no consistency issues are found", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"), "name: demo");

    const report = await runConsistency(home);

    expect(report.status).toBe("ok");
    expect(report.summary.total).toBe(0);
    expect(report.issues).toEqual([]);
  });
});
