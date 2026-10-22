import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getPaths } from "../src/protocol/paths.js";
import {
  assertWritableSchema,
  readArchiveManifest,
  readExternalImports,
  readCache,
  readLock,
  readMetadata,
  writeLock,
} from "../src/protocol/store.js";
import { makeTempHome } from "./helpers.js";

describe("desktop local protocol fixtures", () => {
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
      commitSha: "abc123",
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

  it("preserves unknown lock fields when updating a known entry", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await copyFixture("lock-v3-full.json", paths.agentLockFile);
    const fixtureBefore = await fs.readFile(paths.agentLockFile, "utf8");

    const lock = await readLock(home);
    lock.skills.demo!.skillPath = "skills/new-demo";
    await writeLock(home, lock);

    const reread = await readLock(home);
    const root = reread as unknown as Record<string, unknown>;
    const entry = reread.skills.demo as Record<string, unknown> | undefined;
    expect(reread.skills.demo?.skillPath).toBe("skills/new-demo");
    expect(root["futureTop"]).toBe("keep-me");
    expect(entry?.["futureOptional"]).toBe("keep-me");
    // The desktop's content baseline round-trips untouched: the CLI reads and
    // preserves it without interpreting it.
    expect(reread.skills.demo?.skillFolderHash).toBe(
      "8293db63637957643abb559a59c1122ef387e21f61b60e8b0b3b2dfda73bae36",
    );
    // Fixtures represent desktop protocol state and must never be rewritten.
    expect(await fs.readFile(fixturePath("lock-v3-full.json"), "utf8")).toBe(fixtureBefore);
  });

  it("tolerates a legacy empty skillFolderHash as an unknown baseline", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await copyFixture("lock-v3-full.json", paths.agentLockFile);

    const lock = await readLock(home);
    lock.skills.demo!.skillFolderHash = "";
    await writeLock(home, lock);

    const reread = await readLock(home);
    expect(reread.skills.demo?.skillFolderHash).toBe("");
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

  it("migrates legacy metadata keys to the canonical identity on read", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await copyFixture("metadata-legacy-repo-keys.json", paths.metadataFile);

    const original = await fs.readFile(paths.metadataFile, "utf8");
    expect(Object.keys(JSON.parse(original).entries).some((key) => key.startsWith("repo:"))).toBe(
      true,
    );
    const metadata = await readMetadata(home);

    // Legacy repo keys merge (OR) into canonical ssot keys.
    expect(metadata.entries["ssot:demo"]).toEqual({ starred: true, isMine: true });
    expect(metadata.entries["ssot:category/nested"]).toEqual({ starred: false, isMine: true });
    expect(metadata.entries["ssot:kept"]).toEqual({ starred: true, isMine: false });
    expect(metadata.entries["agent:codex:/Users/example/.codex/skills/local-skill"]).toEqual({
      starred: true,
      isMine: true,
    });
    expect(metadata.entries["external:demo-a1b2c3d4"]).toEqual({ starred: false, isMine: true });
    expect(Object.keys(metadata.entries).some((key) => key.startsWith("repo:"))).toBe(false);

    expect(metadata.entries["ssot:foo:bar"]).toEqual({ starred: true, isMine: true });
    expect(await fs.readFile(fixturePath("metadata-legacy-repo-keys.json"), "utf8")).toBe(original);

    // The migration converges on disk.
    const persisted = JSON.parse(await fs.readFile(paths.metadataFile, "utf8"));
    expect(persisted.entries).toEqual(metadata.entries);
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
