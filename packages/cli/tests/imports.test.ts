import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { getPaths } from "../src/protocol/paths.js";
import {
  cleanExternalImportLinks,
  importExternalSkills,
  listExternalImports,
  removeExternalImport,
  scanExternalImportFolder,
} from "../src/protocol/imports.js";
import { readExternalImports } from "../src/protocol/store.js";
import { createDirLink, makeTempHome, writeJson, writeSkill } from "./helpers.js";

class CaptureStream extends Writable {
  chunks: Buffer[] = [];

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }

  toString() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

// ---------------------------------------------------------------------------
// listExternalImports
// ---------------------------------------------------------------------------

describe("listExternalImports", () => {
  it("returns empty array when no imports exist", async () => {
    const home = await makeTempHome();
    const result = await listExternalImports(home);
    expect(result).toEqual([]);
  });

  it("lists a valid import with name, description, and linked agents", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private-skills", "utils");
    await writeSkill(sourcePath, "name: Utils\ndescription: Helper utilities");

    await writeJson(getPaths(home).externalImportsFile, {
      version: 1,
      imports: {
        "external:utils-a1b2c3d4": {
          id: "external:utils-a1b2c3d4",
          sourcePath,
          directory: "utils",
          importedAt: 1700000000,
          updatedAt: 1700000100,
        },
      },
    });

    const result = await listExternalImports(home);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "external:utils-a1b2c3d4",
      sourcePath,
      directory: "utils",
      name: "Utils",
      description: "Helper utilities",
      status: "valid",
      linkedAgents: [],
    });
  });

  it("marks source-missing when sourcePath does not exist", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "gone");

    await writeJson(getPaths(home).externalImportsFile, {
      version: 1,
      imports: {
        "external:gone-a1b2c3d4": {
          id: "external:gone-a1b2c3d4",
          sourcePath,
          directory: "gone",
          importedAt: 1700000000,
          updatedAt: 1700000100,
        },
      },
    });

    const result = await listExternalImports(home);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("source-missing");
    expect(result[0].name).toBe("gone");
  });

  it("marks skill-missing when source exists but SKILL.md missing", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "empty-folder");
    const fs = await import("node:fs/promises");
    await fs.mkdir(sourcePath, { recursive: true });

    await writeJson(getPaths(home).externalImportsFile, {
      version: 1,
      imports: {
        "external:empty-a1b2c3d4": {
          id: "external:empty-a1b2c3d4",
          sourcePath,
          directory: "empty-folder",
          importedAt: 1700000000,
          updatedAt: 1700000100,
        },
      },
    });

    const result = await listExternalImports(home);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("skill-missing");
  });

  it("detects linked agents via symlink resolution", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private-skills", "linked");
    await writeSkill(sourcePath, "name: Linked");

    const paths = getPaths(home);
    // Create a symlink in the claude-code agent dir
    const claudeDir = path.join(home, ".claude", "skills");
    await createDirLink(sourcePath, path.join(claudeDir, "linked"));

    await writeJson(paths.externalImportsFile, {
      version: 1,
      imports: {
        "external:linked-a1b2c3d4": {
          id: "external:linked-a1b2c3d4",
          sourcePath,
          directory: "linked",
          importedAt: 1700000000,
          updatedAt: 1700000100,
        },
      },
    });

    const result = await listExternalImports(home);
    expect(result).toHaveLength(1);
    expect(result[0].linkedAgents).toContain("claude-code");
  });

  it("sorts valid imports before missing ones", async () => {
    const home = await makeTempHome();
    const validPath = path.join(home, "private-skills", "alpha");
    await writeSkill(validPath, "name: Alpha");
    const gonePath = path.join(home, "private-skills", "beta");

    await writeJson(getPaths(home).externalImportsFile, {
      version: 1,
      imports: {
        "external:beta-b1b2c3d4": {
          id: "external:beta-b1b2c3d4",
          sourcePath: gonePath,
          directory: "beta",
          importedAt: 1700000000,
          updatedAt: 1700000100,
        },
        "external:alpha-a1b2c3d4": {
          id: "external:alpha-a1b2c3d4",
          sourcePath: validPath,
          directory: "alpha",
          importedAt: 1700000000,
          updatedAt: 1700000100,
        },
      },
    });

    const result = await listExternalImports(home);
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe("valid");
    expect(result[1].status).toBe("source-missing");
  });
});

// ---------------------------------------------------------------------------
// scanExternalImportFolder
// ---------------------------------------------------------------------------

describe("scanExternalImportFolder", () => {
  it("finds skill directories with SKILL.md", async () => {
    const home = await makeTempHome();
    const scanDir = path.join(home, "my-skills");
    await writeSkill(path.join(scanDir, "utils"), "name: Utils");
    await writeSkill(path.join(scanDir, "tools"), "name: Tools");

    const result = await scanExternalImportFolder(home, scanDir);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.name).sort()).toEqual(["Tools", "Utils"]);
  });

  it("single skill in the target folder itself", async () => {
    const home = await makeTempHome();
    const scanDir = path.join(home, "my-skill");
    await writeSkill(scanDir, "name: MySkill");

    const result = await scanExternalImportFolder(home, scanDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("MySkill");
    expect(result[0].sourcePath).toBe(scanDir);
  });

  it("skips node_modules and other SKIP_DIRS", async () => {
    const home = await makeTempHome();
    const scanDir = path.join(home, "my-skills");
    await writeSkill(path.join(scanDir, "utils"), "name: Utils");
    await writeSkill(path.join(scanDir, "node_modules", "some-pkg"), "name: Ignored");

    const result = await scanExternalImportFolder(home, scanDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Utils");
  });

  it("marks alreadyImported for known source paths", async () => {
    const home = await makeTempHome();
    const scanDir = path.join(home, "my-skills");
    const utilsDir = path.join(scanDir, "utils");
    await writeSkill(utilsDir, "name: Utils");

    // Register it in imports.json
    await writeJson(getPaths(home).externalImportsFile, {
      version: 1,
      imports: {
        "external:utils-a1b2c3d4": {
          id: "external:utils-a1b2c3d4",
          sourcePath: path.resolve(utilsDir),
          directory: "utils",
          importedAt: 1700000000,
          updatedAt: 1700000100,
        },
      },
    });

    const result = await scanExternalImportFolder(home, scanDir);
    expect(result).toHaveLength(1);
    expect(result[0].alreadyImported).toBe(true);
  });

  it("rejects paths inside the SSOT skills dir", async () => {
    const home = await makeTempHome();
    const ssotDir = getPaths(home).agentsSkillsDir;
    await writeSkill(ssotDir, "name: Inside");

    await expect(scanExternalImportFolder(home, ssotDir)).rejects.toThrow("inside a managed skill root");
  });

  it("rejects paths that do not exist", async () => {
    const home = await makeTempHome();
    await expect(scanExternalImportFolder(home, "/no/such/path")).rejects.toThrow("not a directory");
  });

  it("returns empty for folder with no SKILL.md files", async () => {
    const home = await makeTempHome();
    const emptyDir = path.join(home, "empty");
    const fs = await import("node:fs/promises");
    await fs.mkdir(emptyDir, { recursive: true });

    const result = await scanExternalImportFolder(home, emptyDir);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// importExternalSkills
// ---------------------------------------------------------------------------

describe("importExternalSkills", () => {
  it("dry-run returns planned changes without writing", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    const result = await importExternalSkills(home, [sourcePath], ["claude-code"], { dryRun: true });

    expect(result.added).toHaveLength(1);
    expect(result.failed).toEqual([]);
    expect(result.changes.length).toBeGreaterThan(0);

    // Verify no writes happened
    const imports = await readExternalImports(home);
    expect(Object.keys(imports.imports)).toHaveLength(0);
  });

  it("adds entry to imports.json and creates symlinks", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    const result = await importExternalSkills(home, [sourcePath], ["claude-code"]);

    expect(result.added).toHaveLength(1);
    expect(result.failed).toEqual([]);

    // Verify imports.json
    const imports = await readExternalImports(home);
    expect(Object.keys(imports.imports)).toHaveLength(1);
    const entry = Object.values(imports.imports)[0];
    expect(entry.sourcePath).toBe(sourcePath);
    expect(entry.directory).toBe("utils");
    expect(entry.id).toMatch(/^external:utils-[a-f0-9]{8}$/);

    // Verify symlink was created in Claude Code skills dir
    const linkPath = path.join(home, ".claude", "skills", "utils");
    const fs = await import("node:fs/promises");
    const linkStat = await fs.lstat(linkPath);
    expect(linkStat.isSymbolicLink()).toBe(true);
  });

  it("fails for missing SKILL.md", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "no-skill");
    const fs = await import("node:fs/promises");
    await fs.mkdir(sourcePath, { recursive: true });

    const result = await importExternalSkills(home, [sourcePath], ["claude-code"]);

    expect(result.added).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain("SKILL.md");
  });

  it("fails for unknown agent", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    await expect(importExternalSkills(home, [sourcePath], ["nonexistent"])).rejects.toThrow("Unknown agent");
  });

  it("reuses existing import ID when re-importing same path", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    const first = await importExternalSkills(home, [sourcePath], ["claude-code"]);
    const firstId = first.added[0];

    const second = await importExternalSkills(home, [sourcePath], ["claude-code"]);
    expect(second.added).toHaveLength(1);
    expect(second.added[0]).toBe(firstId);
  });

  it("skips agents whose skill dirs do not exist", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    // claude-code dir doesn't exist yet
    const result = await importExternalSkills(home, [sourcePath], ["claude-code"]);
    expect(result.added).toHaveLength(1);
    // The symlink creation will fail silently for non-existent agent dirs,
    // but the imports.json entry should still be created
    const imports = await readExternalImports(home);
    expect(Object.keys(imports.imports)).toHaveLength(1);
  });

  it("throws when no agents specified", async () => {
    const home = await makeTempHome();
    await expect(importExternalSkills(home, ["/tmp/test"], [])).rejects.toThrow("agent");
  });
});

// ---------------------------------------------------------------------------
// removeExternalImport
// ---------------------------------------------------------------------------

describe("removeExternalImport", () => {
  it("dry-run returns planned changes without writing", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    const addResult = await importExternalSkills(home, [sourcePath], ["claude-code"]);
    const importId = addResult.added[0];

    const result = await removeExternalImport(home, importId, { dryRun: true });

    expect(result.removed).toEqual([importId]);
    expect(result.changes.length).toBeGreaterThan(0);

    // Verify no writes happened
    const imports = await readExternalImports(home);
    expect(Object.keys(imports.imports)).toHaveLength(1);
  });

  it("removes from imports.json and removes symlinks", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    const addResult = await importExternalSkills(home, [sourcePath], ["claude-code"]);
    const importId = addResult.added[0];

    const result = await removeExternalImport(home, importId);

    expect(result.removed).toEqual([importId]);

    // Verify imports.json entry gone
    const imports = await readExternalImports(home);
    expect(Object.keys(imports.imports)).toHaveLength(0);

    // Verify symlink removed
    const linkPath = path.join(home, ".claude", "skills", "utils");
    const fs = await import("node:fs/promises");
    await expect(fs.lstat(linkPath)).rejects.toThrow("ENOENT");
  });

  it("does NOT delete sourcePath files", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    const addResult = await importExternalSkills(home, [sourcePath], ["claude-code"]);
    await removeExternalImport(home, addResult.added[0]);

    // Source files still exist
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(path.join(sourcePath, "SKILL.md"), "utf8");
    expect(content).toContain("Utils");
  });

  it("throws for unknown import ID", async () => {
    const home = await makeTempHome();
    await expect(removeExternalImport(home, "external:nonexistent-00000000")).rejects.toThrow(
      "External import not found",
    );
  });
});

// ---------------------------------------------------------------------------
// cleanExternalImportLinks
// ---------------------------------------------------------------------------

describe("cleanExternalImportLinks", () => {
  it("cleans stale symlinks for invalid imports", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    // Import and create symlinks
    const addResult = await importExternalSkills(home, [sourcePath], ["claude-code"]);
    const importId = addResult.added[0];

    // Now delete the source to make it invalid
    const fs = await import("node:fs/promises");
    await fs.rm(sourcePath, { recursive: true, force: true });

    const result = await cleanExternalImportLinks(home);

    expect(result.cleaned).toContain(importId);
    expect(result.changes.length).toBeGreaterThan(0);

    // Verify symlink removed
    const linkPath = path.join(home, ".claude", "skills", "utils");
    await expect(fs.lstat(linkPath)).rejects.toThrow("ENOENT");

    // Verify imports.json entry still exists
    const imports = await readExternalImports(home);
    expect(Object.keys(imports.imports)).toHaveLength(1);
  });

  it("cleans only the specified import when importId is given", async () => {
    const home = await makeTempHome();
    const utilsPath = path.join(home, "private", "utils");
    const toolsPath = path.join(home, "private", "tools");
    await writeSkill(utilsPath, "name: Utils");
    await writeSkill(toolsPath, "name: Tools");

    const utilsResult = await importExternalSkills(home, [utilsPath], ["claude-code"]);
    const toolsResult = await importExternalSkills(home, [toolsPath], ["claude-code"]);
    const utilsId = utilsResult.added[0];
    const toolsId = toolsResult.added[0];

    // Delete both sources
    const fs = await import("node:fs/promises");
    await fs.rm(utilsPath, { recursive: true, force: true });
    await fs.rm(toolsPath, { recursive: true, force: true });

    // Clean only utils
    const result = await cleanExternalImportLinks(home, utilsId);

    expect(result.cleaned).toEqual([utilsId]);
    expect(result.cleaned).not.toContain(toolsId);
  });

  it("returns empty when no invalid imports exist", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    await importExternalSkills(home, [sourcePath], ["claude-code"]);

    const result = await cleanExternalImportLinks(home);
    expect(result.cleaned).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it("dry-run returns planned changes without removing links", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    const addResult = await importExternalSkills(home, [sourcePath], ["claude-code"]);
    const importId = addResult.added[0];

    const fs = await import("node:fs/promises");
    await fs.rm(sourcePath, { recursive: true, force: true });

    const result = await cleanExternalImportLinks(home, undefined, { dryRun: true });

    expect(result.cleaned).toContain(importId);
    expect(result.changes.length).toBeGreaterThan(0);

    // Symlink should still exist
    const linkPath = path.join(home, ".claude", "skills", "utils");
    const linkStat = await fs.lstat(linkPath);
    expect(linkStat.isSymbolicLink()).toBe(true);
  });

  it("throws for unknown import ID", async () => {
    const home = await makeTempHome();
    await expect(cleanExternalImportLinks(home, "external:nonexistent-00000000")).rejects.toThrow(
      "External import not found",
    );
  });
});

// ---------------------------------------------------------------------------
// CLI integration
// ---------------------------------------------------------------------------

describe("CLI imports commands", () => {
  it("imports --json outputs valid JSON envelope", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    // First add to have something to list
    await importExternalSkills(home, [sourcePath], ["claude-code"]);

    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    await runCli(["--home", home, "imports", "--json"], { stdout, stderr, stdin: process.stdin });

    const parsed = JSON.parse(stdout.toString()) as { ok: boolean; data: unknown };
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.data)).toBe(true);
    expect((parsed.data as unknown[]).length).toBe(1);
  });

  it("imports scan --json outputs candidates", async () => {
    const home = await makeTempHome();
    const scanDir = path.join(home, "my-skills");
    await writeSkill(path.join(scanDir, "utils"), "name: Utils");

    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    await runCli(["--home", home, "imports", "scan", scanDir, "--json"], { stdout, stderr, stdin: process.stdin });

    const parsed = JSON.parse(stdout.toString()) as { ok: boolean; data: unknown[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.length).toBe(1);
    expect((parsed.data[0] as Record<string, unknown>).name).toBe("Utils");
  });

  it("imports add --dry-run --json prevents writes", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    await runCli(["--home", home, "imports", "add", sourcePath, "--agent", "claude-code", "--dry-run", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    const parsed = JSON.parse(stdout.toString()) as { ok: boolean; data: { dryRun: boolean; wouldImport: string[] } };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.dryRun).toBe(true);
    expect(parsed.data.wouldImport.length).toBe(1);

    // Should not have written imports.json
    const imports = await readExternalImports(home);
    expect(Object.keys(imports.imports)).toHaveLength(0);
  });

  it("imports add --yes --json performs real import", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    await runCli(["--home", home, "imports", "add", sourcePath, "--agent", "claude-code", "--yes", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    const parsed = JSON.parse(stdout.toString()) as { ok: boolean; data: { added: string[] } };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.added.length).toBe(1);

    // Verify import was written
    const imports = await readExternalImports(home);
    expect(Object.keys(imports.imports)).toHaveLength(1);
  });

  it("list --origin external filters external skills", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    await importExternalSkills(home, [sourcePath], ["claude-code"]);

    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    // Should work without error
    await runCli(["--home", home, "list", "--origin", "external", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    const parsed = JSON.parse(stdout.toString()) as { ok: boolean; data: unknown[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.length).toBeGreaterThanOrEqual(1);
  });

  it("imports remove --dry-run --json shows planned changes", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    const addResult = await importExternalSkills(home, [sourcePath], ["claude-code"]);
    const importId = addResult.added[0];

    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    await runCli(["--home", home, "imports", "remove", importId, "--dry-run", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    const parsed = JSON.parse(stdout.toString()) as { ok: boolean; data: { removed: string[] } };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.removed).toContain(importId);

    // Verify nothing was removed
    const imports = await readExternalImports(home);
    expect(Object.keys(imports.imports)).toHaveLength(1);
  });

  it("imports clean --dry-run --json shows planned changes", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    const addResult = await importExternalSkills(home, [sourcePath], ["claude-code"]);
    const importId = addResult.added[0];

    // Delete source to make it invalid
    const fs = await import("node:fs/promises");
    await fs.rm(sourcePath, { recursive: true, force: true });

    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    await runCli(["--home", home, "imports", "clean", "--dry-run", "--json"], {
      stdout,
      stderr,
      stdin: process.stdin,
    });

    const parsed = JSON.parse(stdout.toString()) as { ok: boolean; data: { cleaned: string[] } };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.cleaned).toContain(importId);
  });

  it("rejects refused writes in non-interactive shell without --yes", async () => {
    const home = await makeTempHome();
    const sourcePath = path.join(home, "private", "utils");
    await writeSkill(sourcePath, "name: Utils");

    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    const fakeStdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    // Non-TTY stdin
    (fakeStdin as unknown as { isTTY: boolean }).isTTY = false;

    await runCli(["--home", home, "imports", "add", sourcePath, "--agent", "claude-code", "--json"], {
      stdout,
      stderr,
      stdin: fakeStdin as unknown as NodeJS.ReadableStream,
    });

    const parsed = JSON.parse(stdout.toString()) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("Refusing to write");
  });
});
