import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { archiveSkillRefs, restoreArchiveIds } from "../src/protocol/archive.js";
import { rebuildCache } from "../src/protocol/scan.js";
import { getPaths } from "../src/protocol/paths.js";
import {
  assertWritableSchema,
  readArchiveManifest,
  readExternalImports,
  readCache,
  readLock,
} from "../src/protocol/store.js";
import { makeTempHome } from "./helpers.js";
import type { SkillLock } from "../src/protocol/types.js";

describe("desktop local protocol fixtures", () => {
  it("preserves actual gh-injected bytes through scan, archive and restore", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const skillDir = path.join(paths.agentsSkillsDir, "demo");
    await fs.mkdir(skillDir, { recursive: true });
    const original = await fs.readFile(fixturePath("gh-injected.md"));
    await fs.writeFile(path.join(skillDir, "SKILL.md"), original);
    await copyFixture("lock-v3-full.json", paths.agentLockFile);
    const matching = await readLock(home);
    matching.skills.demo = { ...matching.skills.demo, source: "vercel-labs/skills", sourceUrl: "https://github.com/vercel-labs/skills", skillPath: "skills/find-skills" };
    await fs.writeFile(paths.agentLockFile, JSON.stringify(matching));
    const lockBefore = await fs.readFile(paths.agentLockFile);
    const entryBefore = (await readLock(home)).skills.demo;
    const scanned = await rebuildCache(home);
    expect(scanned.some((skill) => skill.directory === "demo")).toBe(true);
    expect(await fs.readFile(path.join(skillDir, "SKILL.md"))).toEqual(original);
    expect(await fs.readFile(paths.agentLockFile)).toEqual(lockBefore);

    const archived = await archiveSkillRefs(home, ["demo"]);
    expect(archived.failed).toEqual([]);
    const manifest = await readArchiveManifest(home);
    const archiveId = Object.keys(manifest.skills)[0]!;
    expect(await fs.readFile(path.join(paths.archiveSkillsDir, archiveId, "SKILL.md"))).toEqual(original);
    const restored = await restoreArchiveIds(home, [archiveId]);
    expect(restored.failed).toEqual([]);
    expect(await fs.readFile(path.join(skillDir, "SKILL.md"))).toEqual(original);
    expect((await readLock(home)).skills.demo).toEqual(entryBefore);
  });

  it("reads current lock and archive fixtures", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await copyFixture("lock-v3-full.json", paths.agentLockFile);
    await copyFixture("archive-v1-full.json", paths.archiveManifestFile);
    await copyFixture("imports-v1-full.json", paths.externalImportsFile);

    const lock = await readLock(home);
    const manifest = await readArchiveManifest(home);
    const imports = await readExternalImports(home);

    expect(lock.version).toBe(3);
    expect(lock.skills.demo).toMatchObject({
      source: "owner/repo",
      sourceType: "github",
      sourceUrl: "https://github.com/owner/repo",
      ref: "main",
      skillPath: "skills/demo",
      commitSha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    });
    expect(manifest.version).toBe(1);
    expect(manifest.skills["demo-abc123"]).toMatchObject({
      archiveId: "demo-abc123",
      originalSkillId: "repo:owner/repo:demo",
      name: "demo",
      lockKey: "demo",
      archivedByVersion: "0.2.9",
    });
    expect(manifest.skills["demo-abc123"]?.apps.codex).toBe(true);
    expect(manifest.skills["demo-abc123"]?.lockEntry?.source).toBe("owner/repo");
    expect(imports.version).toBe(1);
    expect(imports.imports["external:demo-a1b2c3d4"]).toMatchObject({
      id: "external:demo-a1b2c3d4",
      sourcePath: "/Users/example/private-skills/skills/demo",
      directory: "skills/demo",
    });
  });

  it("applies defaults for minimal current fixtures", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await copyFixture("lock-v3-minimal.json", paths.agentLockFile);
    await copyFixture("archive-v1-minimal.json", paths.archiveManifestFile);
    await copyFixture("imports-v1-minimal.json", paths.externalImportsFile);

    const lock = await readLock(home);
    const manifest = await readArchiveManifest(home);
    const imports = await readExternalImports(home);

    expect(lock.version).toBe(3);
    expect(lock.skills).toEqual({});
    expect(manifest.version).toBe(1);
    expect(manifest.skills).toEqual({});
    expect(imports.version).toBe(1);
    expect(imports.imports).toEqual({});
  });

  it("preserves undeclared lock fields across a desktop-shaped rewrite", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await copyFixture("lock-v3-external-writers.json", paths.agentLockFile);

    type LockWithUndeclared = SkillLock & { futureTopLevel?: unknown };
    const lock = (await readLock(home)) as LockWithUndeclared;
    expect(lock.skills.demo?.pinnedRef).toBeUndefined();
    expect(lock.skills.foreignPinned?.pinnedRef ?? lock.skills["foreign-pinned"]?.pinnedRef).toBe(
      "abc1234",
    );
    expect(lock.skills.conflicted).toMatchObject({
      skillFolderHash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      commitSha: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0a1",
    });
    expect(lock.skills.unrecorded?.skillFolderHash).toBeUndefined();
    expect(lock.futureTopLevel).toEqual({
      note: "preserve me",
    });

    // Rewrite the lock exactly like the desktop does (read → mutate unrelated
    // entry → write) and confirm nothing undeclared is lost.
    lock.skills["added-by-rewrite"] = { source: "owner/other" };
    const { writeLock } = await import("../src/protocol/store.js");
    await writeLock(home, lock);

    const reread = JSON.parse(
      await fs.readFile(paths.agentLockFile, "utf8"),
    ) as LockWithUndeclared;
    expect(reread.skills.demo).toMatchObject({
      externalNote: { kept: true },
      skillFolderHash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    });
    expect(reread.skills.demo?.pinnedRef).toBeUndefined();
    expect(reread.skills["foreign-pinned"]?.pinnedRef).toBe("abc1234");
    expect(reread.skills["added-by-rewrite"]?.source).toBe("owner/other");
    expect(reread.skills.conflicted).toMatchObject({
      skillFolderHash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      commitSha: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0a1",
    });
    expect(reread.skills.unrecorded?.skillFolderHash).toBeUndefined();
    expect(reread.futureTopLevel).toEqual({
      note: "preserve me",
    });
  });

  it("preserves legacy conflicted lock entries through scan, archive and restore", async () => {
    // The CLI never repairs conflicted carriers — that is desktop-owned
    // behavior (verified-conflict resolution). Its boundary stays
    // scan → archive → restore preserving lock bytes.
    const home = await makeTempHome();
    const paths = getPaths(home);
    const skillDir = path.join(paths.agentsSkillsDir, "verified-carrier");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: verified-carrier\ndescription: fixture\n---\ncarrier content\n",
    );
    await copyFixture("lock-v3-legacy-conflicts.json", paths.agentLockFile);
    const lockBefore = await fs.readFile(paths.agentLockFile);

    const scanned = await rebuildCache(home);
    expect(
      scanned.some((skill) => skill.directory === "verified-carrier"),
    ).toBe(true);
    expect(await fs.readFile(paths.agentLockFile)).toEqual(lockBefore);

    const archived = await archiveSkillRefs(home, ["verified-carrier"]);
    expect(archived.failed).toEqual([]);
    const manifest = await readArchiveManifest(home);
    const archiveId = Object.keys(manifest.skills)[0]!;
    const restored = await restoreArchiveIds(home, [archiveId]);
    expect(restored.failed).toEqual([]);

    // Every entry survives field-for-field, including the conflicted carriers,
    // unknown fields and the entries the CLI never touches. Key order may
    // change when the lock is rewritten, so compare the parsed objects.
    const before = JSON.parse(lockBefore.toString()) as {
      skills: Record<string, unknown>;
    };
    const after = JSON.parse(
      (await fs.readFile(paths.agentLockFile)).toString(),
    ) as { skills: Record<string, unknown> };
    expect(after.skills).toEqual(before.skills);
  });

  it("tolerates legacy skills cache entries without apps", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await fs.mkdir(path.dirname(paths.skillsCacheFile), { recursive: true });
    await fs.writeFile(
      paths.skillsCacheFile,
      JSON.stringify({
        skills: [
          {
            id: "ssot:legacy",
            name: "legacy",
            directory: "legacy",
            origin: "ssot",
            installedAt: 1000,
            updatedAt: 2000,
          },
        ],
      }),
    );

    const cache = await readCache(home);

    expect(cache.skills).toHaveLength(1);
    expect(cache.skills[0]?.apps).toBeUndefined();
  });

  it("refuses writes for future desktop protocol versions", async () => {
    const lockHome = await makeTempHome();
    await copyFixture("lock-v4-future.json", getPaths(lockHome).agentLockFile);
    const v4Lock = await readLock(lockHome);
    const v4Manifest = await readArchiveManifest(lockHome);
    const v4Imports = await readExternalImports(lockHome);
    expect(() => assertWritableSchema(v4Lock, v4Manifest, v4Imports)).toThrow(
      "Lock file version 4 is newer than this CLI supports",
    );

    const archiveHome = await makeTempHome();
    await copyFixture("archive-v2-future.json", getPaths(archiveHome).archiveManifestFile);
    const v2Lock = await readLock(archiveHome);
    const v2Manifest = await readArchiveManifest(archiveHome);
    const v2Imports = await readExternalImports(archiveHome);
    expect(() => assertWritableSchema(v2Lock, v2Manifest, v2Imports)).toThrow(
      "Archive manifest version 2 is newer than this CLI supports",
    );

    const importsHome = await makeTempHome();
    await copyFixture("imports-v2-future.json", getPaths(importsHome).externalImportsFile);
    const futLock = await readLock(importsHome);
    const futManifest = await readArchiveManifest(importsHome);
    const futImports = await readExternalImports(importsHome);
    expect(() => assertWritableSchema(futLock, futManifest, futImports)).toThrow(
      "External imports version 2 is newer than this CLI supports",
    );
  });
});

function fixturePath(name: string): string {
  // import.meta.dirname (Node 21.2+) avoids Vite /@fs/ prefix on import.meta.url
  const dir = typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(dir, "../../../fixtures/local-protocol", name);
}

async function copyFixture(name: string, destination: string): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(fixturePath(name), destination);
}
