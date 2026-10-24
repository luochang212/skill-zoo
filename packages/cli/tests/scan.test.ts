import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getPaths } from "../src/protocol/paths.js";
import { computeContentHash, rebuildCache, scanInstalledSkills } from "../src/protocol/scan.js";
import { readCache } from "../src/protocol/store.js";
import { normalizePath } from "../src/lib/io.js";
import { createDirLink, makeTempHome, writeJson, writeSkill } from "./helpers.js";

describe("scanInstalledSkills", () => {
  it.skipIf(process.platform === "win32")(
    "preserves metadata for directories containing colons",
    async () => {
      const home = await makeTempHome();
      const paths = getPaths(home);
      await writeSkill(path.join(paths.agentsSkillsDir, "foo:bar"));
      await writeJson(paths.metadataFile, {
        entries: { "repo:owner/repo:foo:bar": { starred: true, isMine: true } },
      });

      expect(await scanInstalledSkills(home)).toMatchObject([
        { id: "ssot:foo:bar", starred: true, isMine: true },
      ]);
      const persisted = JSON.parse(await fs.readFile(paths.metadataFile, "utf8"));
      expect(persisted.entries).toEqual({ "ssot:foo:bar": { starred: true, isMine: true } });
    },
  );

  it("returns migrated metadata when migration persistence fails", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, "demo"));
    const original = { entries: { "repo:owner/repo:demo": { starred: true, isMine: true } } };
    await writeJson(paths.metadataFile, original);
    const rename = vi
      .spyOn(fs, "rename")
      .mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "EACCES" }));
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await scanInstalledSkills(home)).toMatchObject([
        { id: "ssot:demo", starred: true, isMine: true },
      ]);
      expect(warning).toHaveBeenCalled();
      expect(JSON.parse(await fs.readFile(paths.metadataFile, "utf8"))).toEqual(original);
    } finally {
      rename.mockRestore();
      warning.mockRestore();
    }
  });

  it("keeps user metadata alive when provenance drifts", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    const skillDir = path.join(paths.agentsSkillsDir, "code-audit");
    await writeSkill(skillDir, "name: Code Audit\ndescription: Security checks");
    // Metadata recorded while provenance was known, then the lock disappears.
    await writeJson(paths.metadataFile, {
      entries: {
        "repo:owner/repo:code-audit": { starred: true, isMine: false },
      },
    });

    const skills = await scanInstalledSkills(home);

    expect(skills).toHaveLength(1);
    expect(skills[0]?.id).toBe("ssot:code-audit");
    expect(skills[0]?.starred).toBe(true);
    // The legacy key is migrated on disk, not just in memory.
    const persisted = JSON.parse(await fs.readFile(paths.metadataFile, "utf8"));
    expect(persisted.entries["ssot:code-audit"]).toEqual({ starred: true, isMine: false });
    expect(persisted.entries["repo:owner/repo:code-audit"]).toBeUndefined();
  });
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
      id: "ssot:code-audit",
      name: "code-audit",
      yamlName: "Code Audit",
      description: "Security checks",
      directory: "code-audit",
      repoOwner: "owner",
      repoName: "repo",
      sourceUrl: "https://github.com/owner/repo",
      origin: "ssot",
      homePath: normalizePath(skillDir),
      installedAt: 1767323045,
      updatedAt: 1767409445,
    });
    expect(skills[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(skills[0]?.apps.codex).toBe(true);
    expect(skills[0]?.apps["claude-code"]).toBe(false);
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

    expect(cache.skills[0]?.apps?.codex).toBe(true);
    expect(cache.skills[0]?.apps?.["claude-code"]).toBe(false);
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
      directory: normalizePath(path.join(".system", "openai-docs")),
      origin: "ssot",
    });
    expect(skills[0]?.apps.opencode).toBe(true);
  });

  it("skips app temp/backup dirs but keeps dot-prefixed namespaces", async () => {
    const home = await makeTempHome();
    const paths = getPaths(home);
    await writeSkill(path.join(paths.agentsSkillsDir, ".demo.backup.123.0"), "name: Ghost Backup");
    await writeSkill(path.join(paths.agentsSkillsDir, ".demo.install.456"), "name: Ghost Install");
    await writeSkill(path.join(paths.agentsSkillsDir, ".system", "openai-docs"), "name: System Docs");
    await writeSkill(path.join(paths.agentsSkillsDir, "real-skill"), "name: Real Skill");

    const skills = await scanInstalledSkills(home);

    expect(skills.map((s) => s.name).sort()).toEqual(["openai-docs", "real-skill"]);
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
      homePath: normalizePath(sourceDir),
      homeAgent: null,
      installedAt: 100,
      updatedAt: 200,
    });
  });
});

describe("computeContentHash", () => {
  it("hashes depth 20 but returns no partial hash when any directory exceeds it", async () => {
    const root = await makeTempHome();
    try {
      await writeSkill(root);
      const boundary = path.join(root, ...Array<string>(20).fill("d"));
      await fs.mkdir(boundary, { recursive: true });
      await fs.writeFile(path.join(boundary, "file.txt"), "boundary");
      expect(await computeContentHash(root)).toMatch(/^[a-f0-9]{64}$/);
      await fs.mkdir(path.join(boundary, "d"));
      expect(await computeContentHash(root)).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("matches the pinned cross-runtime content hash vector", async () => {
    const { computeContentHash } = await import("../src/protocol/scan.js");
    const vectorDir = path.resolve(__dirname, "../../../fixtures/local-protocol/content-hash-vector");
    const expected = JSON.parse(
      await fs.readFile(
        path.resolve(__dirname, "../../../fixtures/local-protocol/content-hash-vector-expected.json"),
        "utf8",
      ),
    ) as { expectedDigests: { unix: string; windows: string } };

    expect(await computeContentHash(vectorDir)).toBe(
      expected.expectedDigests[process.platform === "win32" ? "windows" : "unix"],
    );
  });
});
