import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { makeTempHome } from "../../tests/helpers.js";
import { createAgentLink } from "../lib/io.js";
import { getPaths, getAgentSkillsDir } from "./paths.js";
import { readLock, writeLock, readArchiveManifest } from "./store.js";
import {
  collectInstallations,
  resolveInstallationLock,
  normalizeLockSkillPath,
} from "./lock-resolution.js";
import { scanInstalledSkills } from "./scan.js";
import { archiveSkillRefs, restoreArchiveIds } from "./archive.js";
import type { SkillLock } from "./types.js";
const layouts: {
  name: string;
  directories: { directory: string; origin: string; text: string }[];
  lock: SkillLock;
  expected: string[];
  links?: { directory: string; target: number }[];
}[] = JSON.parse(
  await fs.readFile(
    new URL("../../../../fixtures/local-protocol/lock-resolution-layouts.json", import.meta.url),
    "utf8",
  ),
);

describe("desktop-owned real lock layouts", () => {
  for (const layout of layouts)
    it(layout.name, async () => {
      const home = await makeTempHome();
      const paths = getPaths(home);
      const targets: string[] = [];
      for (const d of layout.directories) {
        const root =
          d.origin === "ssot"
            ? paths.agentsSkillsDir
            : d.origin === "agent"
              ? getAgentSkillsDir(home, "codex")!
              : path.join(home, "external");
        const target = path.join(root, d.directory);
        await fs.mkdir(target, { recursive: true });
        await fs.writeFile(path.join(target, "SKILL.md"), d.text);
        targets.push(await fs.realpath(target));
        if (d.origin === "external") {
          await fs.mkdir(path.dirname(paths.externalImportsFile), { recursive: true });
          await fs.writeFile(
            paths.externalImportsFile,
            JSON.stringify({
              version: 1,
              imports: {
                "external:demo": {
                  id: "external:demo",
                  directory: d.directory,
                  sourcePath: target,
                  importedAt: 1,
                  updatedAt: 1,
                },
              },
            }),
          );
        }
      }
      for (const link of layout.links ?? []) {
        const root = getAgentSkillsDir(home, "codex")!;
        await fs.mkdir(root, { recursive: true });
        await createAgentLink(path.join(root, link.directory), targets[link.target]!);
      }
      await writeLock(home, layout.lock);
      const before = await fs.readFile(paths.agentLockFile);
      const inventory = await collectInstallations(home);
      for (const [index, homePath] of targets.entries()) {
        const target = inventory.find((item) => item.homePath === homePath)!;
        if (layout.directories[index]!.origin === "external") {
          expect(inventory.some((item) => item.homePath === homePath)).toBe(false);
          expect(
            (await scanInstalledSkills(home)).find((item) => item.origin === "external")?.repoOwner,
          ).toBeNull();
          continue;
        }
        const result = resolveInstallationLock(target, inventory, await readLock(home));
        const actual =
          result.kind === "Resolved"
            ? `Resolved:${result.lockKey}`
            : result.kind === "Ambiguous"
              ? `Ambiguous:${result.reason}`
              : "Missing";
        expect(actual).toBe(layout.expected[index]);
        const scanned = (await scanInstalledSkills(home)).find(
          (item) => item.directory === target.installDirectory && item.origin === target.origin,
        )!;
        expect(Boolean(scanned.repoOwner)).toBe(result.kind === "Resolved");
        if (result.kind === "Ambiguous") {
          const original = await fs.readFile(path.join(homePath, "SKILL.md"));
          for (const dryRun of [true, false]) {
            const archived = await archiveSkillRefs(home, [scanned.id], { dryRun });
            expect(archived.failed[0]?.error).toContain("lockAmbiguous");
            expect(await fs.readFile(path.join(homePath, "SKILL.md"))).toEqual(original);
            expect(Object.keys((await readArchiveManifest(home)).skills)).toEqual([]);
          }
        }
      }
      expect(await fs.readFile(paths.agentLockFile)).toEqual(before);
    });
  it("rejects unsafe paths and strips only complete file components", () => {
    for (const value of ["../demo", "/demo", "C:\\demo"])
      expect(() => normalizeLockSkillPath(value)).toThrow();
    expect(normalizeLockSkillPath("skills/mySKILL.md")).toBe("skills/mySKILL.md");
    expect(normalizeLockSkillPath("skills\\demo\\SKILL.md")).toBe("skills/demo");
    expect(normalizeLockSkillPath("./SKILL.md")).toBe("");
  });
  it("namespace archive restores exact key and rejects replacement before moving", async () => {
    const home = await makeTempHome();
    const layout = layouts.find((item) => item.name === "flat-namespace")!;
    const paths = getPaths(home);
    const dir = path.join(paths.agentsSkillsDir, "demo");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), layout.directories[0]!.text);
    await writeLock(home, layout.lock);
    expect((await archiveSkillRefs(home, ["demo"])).failed).toEqual([]);
    const archived = Object.values((await readArchiveManifest(home)).skills)[0]!;
    expect(archived.lockKey).toBe("author/demo");
    const conflict = structuredClone(layout.lock);
    conflict.skills["author/demo"]!.source = "other/repo";
    await writeLock(home, conflict);
    for (const dryRun of [true, false])
      expect(
        (await restoreArchiveIds(home, [archived.archiveId], { dryRun })).failed[0]?.error,
      ).toContain("key conflict");
    await expect(fs.stat(dir)).rejects.toThrow();
    await writeLock(home, layout.lock);
    expect((await restoreArchiveIds(home, [archived.archiveId])).failed).toEqual([]);
    expect((await readLock(home)).skills).toEqual(layout.lock.skills);
    expect(await fs.readFile(path.join(dir, "SKILL.md"), "utf8")).toBe(layout.directories[0]!.text);
  });
  for (const equalBefore of [false, true])
    it(`restore rollback preserves before values and unrelated edits (${equalBefore})`, async () => {
      const home = await makeTempHome();
      const paths = getPaths(home);
      const layout = layouts.find((item) => item.name === "flat-namespace")!;
      const target = path.join(paths.agentsSkillsDir, "demo");
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(path.join(target, "SKILL.md"), layout.directories[0]!.text);
      await writeLock(home, layout.lock);
      expect((await archiveSkillRefs(home, ["demo"])).failed).toEqual([]);
      const archived = Object.values((await readArchiveManifest(home)).skills)[0]!;
      if (equalBefore) await writeLock(home, layout.lock);
      const rename = fs.rename.bind(fs);
      let injected = false;
      const spy = vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
        if (destination === paths.metadataFile && !injected) {
          injected = true;
          const lock = await readLock(home);
          lock.skills.unrelated = { source: "external/change" };
          await writeLock(home, lock);
          throw new Error("injected metadata save failure");
        }
        await rename(source, destination);
      });
      try {
        const result = await restoreArchiveIds(home, [archived.archiveId]);
        expect(result.failed[0]?.error).toContain("injected");
        expect(injected).toBe(true);
        expect((await readLock(home)).skills["author/demo"]).toEqual(
          equalBefore ? layout.lock.skills["author/demo"] : undefined,
        );
        expect((await readLock(home)).skills.unrelated).toEqual({ source: "external/change" });
        await expect(fs.stat(target)).rejects.toThrow();
        expect(
          (await fs.stat(path.join(paths.archiveSkillsDir, archived.archiveId))).isDirectory(),
        ).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

  it("restores historical opaque lockKey verbatim", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const dir = path.join(paths.agentsSkillsDir, "demo");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), "# Demo");
    await writeLock(home, {
      version: 3,
      skills: { demo: { source: "owner/repo" } },
      dismissed: {},
    });
    expect((await archiveSkillRefs(home, ["demo"])).failed).toEqual([]);
    const manifest = await readArchiveManifest(home);
    const archived = Object.values(manifest.skills)[0]!;
    archived.lockKey = "author\\demo";
    await fs.writeFile(paths.archiveManifestFile, JSON.stringify(manifest));
    expect((await restoreArchiveIds(home, [archived.archiveId])).failed).toEqual([]);
    expect(Object.keys((await readLock(home)).skills)).toEqual(["author\\demo"]);
  });
});
