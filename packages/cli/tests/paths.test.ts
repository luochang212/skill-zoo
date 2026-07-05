import { describe, expect, it } from "vitest";
import path from "node:path";
import { getAgentSkillsDir, getPaths } from "../src/protocol/paths.js";
import { makeTempHome } from "./helpers.js";

describe("paths", () => {
  it("derives the same default Skill Zoo and agent paths as the desktop app", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);

    expect(paths.agentsSkillsDir).toBe(path.join(home, ".agents", "skills"));
    expect(paths.agentLockFile).toBe(path.join(home, ".agents", ".skill-lock.json"));
    expect(paths.archiveManifestFile).toBe(path.join(home, ".skill-zoo", "archive", "manifest.json"));
    expect(paths.externalImportsFile).toBe(path.join(home, ".skill-zoo", "imports.json"));
    expect(getAgentSkillsDir(home, "codex")).toBe(path.join(home, ".codex", "skills"));
    expect(getAgentSkillsDir(home, "claude-code")).toBe(path.join(home, ".claude", "skills"));
  });
});
