import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempHome, writeJson, writeSkill } from "../../tests/helpers.js";
import { getPaths } from "./paths.js";
import { metadataKey, migrateMetadata, readMetadata, writeMetadata } from "./store.js";
import { rebuildCache, scanInstalledSkills } from "./scan.js";
import { archiveSkillRefs, restoreArchiveIds } from "./archive.js";
import type { MetadataStore } from "./types.js";

const fixtureRoot = fileURLToPath(new URL("../../../../fixtures/local-protocol/", import.meta.url));
const homes: string[] = [];
async function homeFixture() {
  const home = await makeTempHome();
  homes.push(home);
  return { home, paths: getPaths(home) };
}
async function fixture(name: string) {
  return JSON.parse(await fs.readFile(path.join(fixtureRoot, name), "utf8"));
}
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true })));
});

describe("user metadata identity", () => {
  it("migrates shared fixtures conservatively, preserves imports and is idempotent", async () => {
    const { home, paths } = await homeFixture();
    for (const directory of ["demo", ".system/nested", "retained", "target", "equal"])
      await writeSkill(path.join(paths.agentsSkillsDir, directory));
    await writeJson(paths.metadataFile, await fixture("metadata-v0-legacy.json"));
    await writeJson(paths.externalImportsFile, {
      version: 1,
      imports: {
        "repo:old/repo:retained": {
          id: "repo:old/repo:retained",
          sourcePath: path.join(home, "retained"),
          directory: "retained",
          importedAt: 0,
          updatedAt: 0,
        },
      },
    });
    const stores = await Promise.all(Array.from({ length: 8 }, () => readMetadata(home)));
    const store = stores[0]!;
    expect(stores.every((current) => JSON.stringify(current) === JSON.stringify(store))).toBe(true);
    expect(store.version).toBe(1);
    expect(store.entries["ssot:demo"]).toEqual({ starred: true, isMine: true });
    expect(store.entries["ssot:.system/nested"]?.starred).toBe(true);
    expect(store.entries["repo:old/repo:retained"]?.starred).toBe(true);
    expect(store.entries["repo:old/repo:missing"]?.isMine).toBe(true);
    const bytes = await fs.readFile(paths.metadataFile, "utf8");
    expect(await readMetadata(home)).toEqual(store);
    expect(await fs.readFile(paths.metadataFile, "utf8")).toBe(bytes);
    const conflicts: MetadataStore = await fixture("metadata-v1-migration-conflicts.json");
    const before = structuredClone(conflicts.entries);
    const pending = await migrateMetadata(conflicts, paths.agentsSkillsDir, new Set());
    expect(pending).toContain("repo:unparseable");
    for (const key of [
      "repo:one/repo:demo",
      "repo:two/repo:demo",
      "ssot:target",
      "repo:owner/repo:target",
      "repo:unparseable",
    ])
      expect(conflicts.entries[key]).toEqual(before[key]);
    expect(conflicts.entries["ssot:demo"]).toBeUndefined();
    expect(conflicts.entries["ssot:equal"]?.isMine).toBe(true);
    expect(conflicts.entries["repo:one/repo:equal"]).toBeUndefined();
    for (const name of ["metadata-v1-minimal.json", "metadata-v1-full.json"]) {
      const current = await fixture(name);
      await writeJson(paths.metadataFile, current);
      expect(await readMetadata(home)).toEqual(current);
      await writeMetadata(home, current);
      expect(await readMetadata(home)).toEqual(current);
    }
  });

  it("real scans preserve both flags through source changes, deleted lock and deleted cache", async () => {
    const { home, paths } = await homeFixture();
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"));
    await writeJson(paths.metadataFile, await fixture("metadata-v0-legacy.json"));
    for (const test of await fixture("source-identity-cases.json")) {
      await writeJson(paths.agentLockFile, {
        version: 3,
        skills: { demo: { source: test.source } },
        dismissed: {},
      });
      await fs.rm(paths.skillsCacheFile, { force: true });
      const skill = (await rebuildCache(home)).find((entry) => entry.directory === "demo")!;
      expect(skill.id).toBe(test.repo ? `repo:${test.repo}:demo` : "ssot:demo");
      expect(skill).toMatchObject({ starred: true, isMine: true });
      expect(
        (await scanInstalledSkills(home)).find((entry) => entry.directory === "demo"),
      ).toMatchObject({ starred: true, isMine: true });
    }
    await fs.rm(paths.agentLockFile);
    await fs.rm(paths.skillsCacheFile);
    expect((await rebuildCache(home))[0]).toMatchObject({
      id: "ssot:demo",
      starred: true,
      isMine: true,
    });
  });

  it("restores the historical archive fixture to its stable slot key", async () => {
    const { home, paths } = await homeFixture();
    const manifest = await fixture("archive-v1-full.json");
    const archived = manifest.skills["demo-abc123"];
    archived.homePath = path.join(paths.agentsSkillsDir, "demo");
    archived.apps = {};
    await writeSkill(path.join(paths.archiveSkillsDir, "demo-abc123"));
    await writeJson(paths.archiveManifestFile, manifest);
    const restored = await restoreArchiveIds(home, ["demo-abc123"]);
    expect(restored.failed).toEqual([]);
    expect((await readMetadata(home)).entries).toEqual({
      "ssot:demo": { starred: true, isMine: false },
    });
    expect((await scanInstalledSkills(home))[0]?.starred).toBe(true);
    const result = await archiveSkillRefs(home, ["demo"]);
    expect(result.failed).toEqual([]);
    expect((await readMetadata(home)).entries["ssot:demo"]).toBeUndefined();
  });

  it("exposes explicit manual assignment and discard without OR, preserving retained imports", async () => {
    const { home, paths } = await homeFixture();
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"));
    const data = await fixture("metadata-v1-migration-conflicts.json");
    data.version = 1;
    await writeJson(paths.metadataFile, data);
    const cli = (args: string[]) =>
      spawnSync(
        "bun",
        [
          fileURLToPath(new URL("../index.ts", import.meta.url)),
          "--home",
          home,
          "metadata",
          ...args,
        ],
        { encoding: "utf8", timeout: 10000 },
      );
    const listed = cli(["list"]);
    expect(listed.status, listed.stderr).toBe(0);
    expect(JSON.parse(listed.stdout)["unrecognized-history"]).toEqual({
      starred: true,
      isMine: false,
    });
    const assigned = cli(["resolve", "repo:two/repo:demo", "--to", "ssot:demo", "--yes"]);
    expect(assigned.status, assigned.stderr).toBe(0);
    expect((await readMetadata(home)).entries["ssot:demo"]).toEqual({
      starred: false,
      isMine: true,
    });
    expect((await readMetadata(home)).entries["repo:two/repo:demo"]).toBeUndefined();
    expect((await readMetadata(home)).entries["repo:one/repo:demo"]).toEqual(
      data.entries["repo:one/repo:demo"],
    );
    const discarded = cli(["resolve", "unrecognized-history", "--discard", "--yes"]);
    expect(discarded.status, discarded.stderr).toBe(0);
    expect((await readMetadata(home)).entries["unrecognized-history"]).toBeUndefined();
    await writeJson(paths.externalImportsFile, {
      version: 1,
      imports: {
        "repo:one/repo:demo": {
          id: "repo:one/repo:demo",
          sourcePath: path.join(home, "external"),
          directory: "demo",
          importedAt: 0,
          updatedAt: 0,
        },
      },
    });
    const protectedResult = cli(["resolve", "repo:one/repo:demo", "--discard", "--yes"]);
    expect(protectedResult.status).toBe(1);
    expect((await readMetadata(home)).entries["repo:one/repo:demo"]).toEqual(
      data.entries["repo:one/repo:demo"],
    );
  });

  it("refuses future writes and archive before touching files; rejects unsafe keys and unknown entry fields", async () => {
    const { home, paths } = await homeFixture();
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"));
    await writeJson(paths.metadataFile, await fixture("metadata-v2-future.json"));
    const before = await fs.readFile(paths.metadataFile, "utf8");
    await expect(writeMetadata(home, { version: 1, entries: {} })).rejects.toThrow("Upgrade");
    const result = await archiveSkillRefs(home, ["demo"]);
    expect(result.archived).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(await fs.readFile(paths.metadataFile, "utf8")).toBe(before);
    expect(await fs.stat(path.join(paths.agentsSkillsDir, "demo/SKILL.md"))).toBeDefined();
    for (const directory of ["../demo", "/demo", "a//b", "a/./b", "a\\b", "a:b"])
      expect(() => metadataKey({ origin: "ssot", directory, id: "old" })).toThrow();
    await writeJson(paths.metadataFile, {
      entries: { "ssot:demo": { starred: true, isMine: false, unknown: 1 } },
    });
    await expect(readMetadata(home)).rejects.toThrow("unsupported");
  });
});
