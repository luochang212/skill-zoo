import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getPaths } from "../src/protocol/paths.js";
import { rebuildCache, scanInstalledSkills } from "../src/protocol/scan.js";
import { readCache } from "../src/protocol/store.js";
import { createDirLink, makeTempHome, writeJson, writeSkill } from "./helpers.js";

describe("scanInstalledSkills", () => {
  it("scans SSOT skills, lock metadata, frontmatter, hashes, and agent links", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const skillDir = path.join(paths.agentsSkillsDir, "code-audit");
    await writeSkill(skillDir, "name: Code Audit\ndescription: Security checks");
    await writeJson(paths.agentLockFile, {
      version: 3,
      skills: {
        "code-audit": {
          source: "owner/repo",
          sourceType: "github",
          installedAt: "2026-01-02T03:04:05Z",
          updatedAt: "2026-01-03T03:04:05Z",
        },
      },
      dismissed: {},
    });

    await fs.mkdir(path.join(home, ".codex", "skills"), { recursive: true });
    await createDirLink(skillDir, path.join(home, ".codex", "skills", "code-audit"));

    const skills = await scanInstalledSkills(home);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: "repo:owner/repo:code-audit",
      name: "code-audit",
      yamlName: "Code Audit",
      description: "Security checks",
      directory: "code-audit",
      repoOwner: "owner",
      repoName: "repo",
      sourceUrl: "https://github.com/owner/repo",
      origin: "ssot",
      homePath: skillDir,
      installedAt: 1767323045,
      updatedAt: 1767409445,
    });
    expect(skills[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(skills[0].apps.codex).toBe(true);
    expect(skills[0].apps["claude-code"]).toBe(false);
  });

  it("writes derived apps into skills cache on rebuild", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const skillDir = path.join(paths.agentsSkillsDir, "cached-apps");
    await writeSkill(skillDir, "name: Cached Apps");
    await fs.mkdir(path.join(home, ".codex", "skills"), { recursive: true });
    await createDirLink(skillDir, path.join(home, ".codex", "skills", "cached-apps"));

    await rebuildCache(home);
    const cache = await readCache(home);

    expect(cache.skills[0].apps?.codex).toBe(true);
    expect(cache.skills[0].apps?.["claude-code"]).toBe(false);
  });

  it("detects flat agent links for nested skill directories", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const skillDir = path.join(paths.agentsSkillsDir, ".system", "openai-docs");
    await writeSkill(skillDir, "name: OpenAI Docs");
    await createDirLink(skillDir, path.join(home, ".opencode", "skills", "openai-docs"));

    const skills = await scanInstalledSkills(home);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      name: "openai-docs",
      directory: path.join(".system", "openai-docs"),
      origin: "ssot",
    });
    expect(skills[0].apps.opencode).toBe(true);
  });

  it("includes valid external imports and skips missing ones", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const sourceDir = path.join(home, "private-skills", "skills", "demo");
    await writeSkill(sourceDir, "name: External Demo");
    await writeJson(paths.externalImportsFile, {
      version: 1,
      imports: {
        "external:demo-a1b2c3d4": {
          id: "external:demo-a1b2c3d4",
          sourcePath: sourceDir,
          directory: "skills/demo",
          importedAt: 100,
          updatedAt: 200,
        },
        "external:missing-a1b2c3d4": {
          id: "external:missing-a1b2c3d4",
          sourcePath: path.join(home, "missing"),
          directory: "missing",
          importedAt: 100,
          updatedAt: 200,
        },
      },
    });

    const skills = await rebuildCache(home);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: "external:demo-a1b2c3d4",
      name: "demo",
      yamlName: "External Demo",
      directory: "skills/demo",
      origin: "external",
      homePath: sourceDir,
      homeAgent: null,
      installedAt: 100,
      updatedAt: 200,
    });
  });
});
