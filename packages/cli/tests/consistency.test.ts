import path from "node:path";
import { describe, expect, it } from "vitest";
import { runConsistency } from "../src/protocol/consistency.js";
import { getPaths } from "../src/protocol/paths.js";
import { makeTempHome, writeSkill } from "./helpers.js";

describe("runConsistency", () => {
  it("reports app-aligned duplicate, conflict, and mismatch issues", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);

    await writeSkill(path.join(paths.agentsSkillsDir, "same"), "name: same\ndescription: Same");
    await writeSkill(path.join(home, ".codex", "skills", "same"), "name: same\ndescription: Same");
    await writeSkill(path.join(paths.agentsSkillsDir, "different"), "name: different\ndescription: One");
    await writeSkill(path.join(home, ".claude", "skills", "different"), "name: different\ndescription: Two");
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
