import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getPaths } from "../src/protocol/paths.js";
import {
  assertWritableSchema,
  readArchiveManifest,
  readLock,
} from "../src/protocol/store.js";
import { makeTempHome } from "./helpers.js";

describe("desktop local protocol fixtures", () => {
  it("reads current lock and archive fixtures", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await copyFixture("lock-v3-full.json", paths.agentLockFile);
    await copyFixture("archive-v1-full.json", paths.archiveManifestFile);

    const lock = await readLock(home);
    const manifest = await readArchiveManifest(home);

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
  });

  it("applies defaults for minimal current fixtures", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await copyFixture("lock-v3-minimal.json", paths.agentLockFile);
    await copyFixture("archive-v1-minimal.json", paths.archiveManifestFile);

    const lock = await readLock(home);
    const manifest = await readArchiveManifest(home);

    expect(lock.version).toBe(3);
    expect(lock.skills).toEqual({});
    expect(manifest.version).toBe(1);
    expect(manifest.skills).toEqual({});
  });

  it("refuses writes for future desktop protocol versions", async () => {
    const lockHome = await makeTempHome();
    await copyFixture("lock-v4-future.json", getPaths(lockHome).agentLockFile);
    await expect(async () => {
      assertWritableSchema(await readLock(lockHome), await readArchiveManifest(lockHome));
    }).rejects.toThrow("Lock file version 4 is newer than this CLI supports");

    const archiveHome = await makeTempHome();
    await copyFixture("archive-v2-future.json", getPaths(archiveHome).archiveManifestFile);
    await expect(async () => {
      assertWritableSchema(await readLock(archiveHome), await readArchiveManifest(archiveHome));
    }).rejects.toThrow("Archive manifest version 2 is newer than this CLI supports");
  });
});

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../../fixtures/local-protocol/${name}`, import.meta.url));
}

async function copyFixture(name: string, destination: string): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(fixturePath(name), destination);
}
