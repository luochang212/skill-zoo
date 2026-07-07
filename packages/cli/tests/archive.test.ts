import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { archiveSkillRefs, makeArchiveId, restoreArchiveIds } from "../src/protocol/archive.js";
import { getPaths } from "../src/protocol/paths.js";
import { rebuildCache } from "../src/protocol/scan.js";
import { readArchiveManifest, readCache, readLock, readMetadata } from "../src/protocol/store.js";
import { isSymlinkOrJunction, normalizePath, pathExists } from "../src/lib/io.js";
import { CLI_VERSION } from "../src/version.js";
import { createDirLink, makeTempHome, writeJson, writeSkill } from "./helpers.js";

describe("archive and restore", () => {
  it("dry-runs archive without writing files", async () => {
    const { home, skillDir } = await createInstalledSkillFixture();

    const result = await archiveSkillRefs(home, ["code-audit"], { dryRun: true });

    expect(result.failed).toEqual([]);
    expect(result.changes.some((change) => change.action === "move")).toBe(true);
    expect(await pathExists(skillDir)).toBe(true);
    expect((await readArchiveManifest(home)).skills).toEqual({});
  });

  it("archives and restores directories, links, lockfile, metadata, manifest, and cache", async () => {
    const { home, paths, skillDir, linkPath, skillId } = await createInstalledSkillFixture();
    const archiveId = makeArchiveId(skillId, "code-audit");

    const archiveResult = await archiveSkillRefs(home, ["code-audit"]);

    expect(archiveResult.failed).toEqual([]);
    expect(archiveResult.archived).toEqual([skillId]);
    expect(await pathExists(skillDir)).toBe(false);
    expect(await pathExists(path.join(paths.archiveSkillsDir, archiveId))).toBe(true);
    expect(await pathExists(linkPath)).toBe(false);
    expect((await readArchiveManifest(home)).skills[archiveId]).toMatchObject({
      archiveId,
      originalSkillId: skillId,
      name: "code-audit",
      lockKey: "code-audit",
      archivedByVersion: `skill-zoo-cli@${CLI_VERSION}`,
    });
    expect((await readLock(home)).skills["code-audit"]).toBeUndefined();
    expect((await readMetadata(home)).entries[skillId]).toBeUndefined();
    expect((await readCache(home)).skills.some((skill) => skill.id === skillId)).toBe(false);

    const restoreResult = await restoreArchiveIds(home, [archiveId]);

    expect(restoreResult.failed).toEqual([]);
    expect(restoreResult.restored).toEqual([archiveId]);
    expect(await pathExists(skillDir)).toBe(true);
    expect(await isSymlinkOrJunction(linkPath)).toBe(true);
    expect((await readArchiveManifest(home)).skills[archiveId]).toBeUndefined();
    expect((await readLock(home)).skills["code-audit"]?.source).toBe("owner/repo");
    expect((await readMetadata(home)).entries[skillId]).toEqual({ starred: true, isMine: true });
    expect((await readCache(home)).skills.some((skill) => skill.id === skillId)).toBe(true);
  });

  it("refuses writes when the archive schema is newer than the CLI supports", async () => {
    const { home, paths } = await createInstalledSkillFixture();
    await writeJson(paths.archiveManifestFile, { version: 2, skills: {} });

    const result = await archiveSkillRefs(home, ["code-audit"]);

    expect(result.archived).toEqual([]);
    expect(result.changes).toEqual([]);
    expect(result.failed[0]?.error).toContain("newer than this CLI supports");
  });

  it("plans only real link changes for agent-native skills", async () => {
    const home = await makeTempHome();
    const skillDir = path.join(home, ".codex", "skills", "local");
    const claudeLink = path.join(home, ".claude", "skills", "local");
    await writeSkill(skillDir, "name: Local");
    await fs.mkdir(path.dirname(claudeLink), { recursive: true });
    await createDirLink(skillDir, claudeLink);

    const archiveResult = await archiveSkillRefs(home, ["local"], { dryRun: true });

    expect(archiveResult.failed).toEqual([]);
    expect(archiveResult.changes).toContainEqual({ action: "remove-link", path: claudeLink });
    expect(archiveResult.changes).not.toContainEqual({
      action: "remove-link",
      path: skillDir,
    });

    await archiveSkillRefs(home, ["local"]);
    const archiveId = Object.keys((await readArchiveManifest(home)).skills)[0];
    expect(archiveId).toBeDefined();

    const restoreResult = await restoreArchiveIds(home, [archiveId!], { dryRun: true });

    expect(restoreResult.failed).toEqual([]);
    expect(restoreResult.changes).toContainEqual({
      action: "create-link",
      path: claudeLink,
      target: normalizePath(skillDir),
    });
    expect(restoreResult.changes).not.toContainEqual({
      action: "create-link",
      path: skillDir,
      target: normalizePath(skillDir),
    });
  });

  it("refuses to archive external imports", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const sourceDir = path.join(home, "private-skills", "demo");
    await writeSkill(sourceDir, "name: External");
    await writeJson(paths.externalImportsFile, {
      version: 1,
      imports: {
        "external:demo-a1b2c3d4": {
          id: "external:demo-a1b2c3d4",
          sourcePath: sourceDir,
          directory: "demo",
          importedAt: 100,
          updatedAt: 200,
        },
      },
    });
    await rebuildCache(home);

    const result = await archiveSkillRefs(home, ["external:demo-a1b2c3d4"]);

    expect(result.archived).toEqual([]);
    expect(result.failed[0]?.error).toContain("External imports cannot be archived");
    expect(await pathExists(sourceDir)).toBe(true);
  });

  it("archives nested skills using flat agent link paths", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const skillDir = path.join(paths.agentsSkillsDir, ".system", "openai-docs");
    const linkPath = path.join(home, ".opencode", "skills", "openai-docs");

    await writeSkill(skillDir, "name: OpenAI Docs");
    await createDirLink(skillDir, linkPath);

    const archiveResult = await archiveSkillRefs(home, ["openai-docs"], { dryRun: true });

    expect(archiveResult.failed).toEqual([]);
    expect(archiveResult.changes).toContainEqual({ action: "remove-link", path: linkPath });
    expect(archiveResult.changes).not.toContainEqual({
      action: "remove-link",
      path: path.join(home, ".opencode", "skills", ".system", "openai-docs"),
    });

    await archiveSkillRefs(home, ["openai-docs"]);
    const archiveId = Object.keys((await readArchiveManifest(home)).skills)[0];
    const restoreResult = await restoreArchiveIds(home, [archiveId!], { dryRun: true });

    expect(restoreResult.failed).toEqual([]);
    expect(restoreResult.changes).toContainEqual({
      action: "create-link",
      path: linkPath,
      target: normalizePath(skillDir),
    });
  });
});

async function createInstalledSkillFixture() {
  const home = await makeTempHome();
  const paths = getPaths(home);
  const skillDir = path.join(paths.agentsSkillsDir, "code-audit");
  const linkPath = path.join(home, ".codex", "skills", "code-audit");
  const skillId = "repo:owner/repo:code-audit";

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
  await writeJson(paths.metadataFile, {
    entries: {
      [skillId]: { starred: true, isMine: true },
    },
  });
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  await createDirLink(skillDir, linkPath);

  return { home, paths, skillDir, linkPath, skillId };
}
