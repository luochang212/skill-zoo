import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempHome } from "../../tests/helpers.js";
import { AGENTS } from "./agents.js";
import { getAgents, getSuppressedAgents, parseAgentRegistry, resetAgentSnapshot } from "./custom-agents.js";
import { getAgentSkillsDir, getAllAgentPaths } from "./paths.js";
import { acquireAgentLease, recoverAgentLifecycle } from "./agent-transaction.js";
import { scanInstalledSkills } from "./scan.js";
import { archiveSkillRefs, listArchivedSkills, restoreArchiveIds } from "./archive.js";
import { writeExternalImports, writeMetadata } from "./store.js";

const fixture = (name: string) => fs.readFile(new URL(`../../../../fixtures/local-protocol/${name}`, import.meta.url), "utf8").then(JSON.parse);

describe("desktop-owned custom agents", () => {
  it("reads the shared complete/minimal fixtures and refuses invalid/future data", async () => {
    expect(parseAgentRegistry(await fixture(process.platform === "win32" ? "agents-v1-windows-full.json" : "agents-v1-full.json")).agents[0]?.label).toBe("Custom Tool");
    expect(parseAgentRegistry(await fixture("agents-v1-minimal.json")).agents).toEqual([]);
    for (const name of ["agents-v1-invalid.json", "agents-v2-future.json"]) {
      const value = await fixture(name);
      expect(() => parseAgentRegistry(value)).toThrow();
    }
  });

  it("reconciles the shared upgrade fixture without rewriting identities or bytes", async () => {
    const home = await makeTempHome();
    const registry = await fixture("agents-v1-builtin-collision.json");
    for (const agent of registry.agents) agent.skillsDir = path.join(home, path.posix.relative("/fixture-home", agent.skillsDir));
    const config = path.join(home, ".skill-zoo");
    await fs.mkdir(config, { recursive: true });
    const file = path.join(config, "agents.json");
    const bytes = JSON.stringify(registry);
    await fs.writeFile(file, bytes);
    const snapshot = getAgents(home);
    expect(snapshot.some((a) => a.id === "codex")).toBe(false);
    expect(snapshot.filter((a) => a.label === "Gemini")).toHaveLength(2);
    expect(getAgentSkillsDir(home, registry.agents[0].id)).toBe(registry.agents[0].skillsDir);
    expect(getAgentSkillsDir(home, "codex")).toBeUndefined();
    expect(getSuppressedAgents(home)).toMatchObject([{ id: "codex", suppressedBy: registry.agents[0].id }]);
    expect(getAllAgentPaths(home).some((a) => a.agent === "codex")).toBe(false);
    expect(getAllAgentPaths(home, true).find((a) => a.agent === "codex")?.suppressedBy).toBe(registry.agents[0].id);
    expect(await fs.readFile(file, "utf8")).toBe(bytes);
    const root = path.join(registry.agents[0].skillsDir, "demo");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "SKILL.md"), "# Demo");
    const [original] = await scanInstalledSkills(home);
    expect(original).toMatchObject({ homeAgent: registry.agents[0].id, origin: "agent" });
    await writeMetadata(home, { entries: { [original!.id]: { starred: true, isMine: true } } });
    await writeExternalImports(home, { version: 1, imports: { [original!.id]: {
      id: original!.id, sourcePath: root, directory: "demo", importedAt: 1, updatedAt: 1,
    } } });
    await fs.writeFile(file, JSON.stringify({ version: 1, agents: [] }));
    resetAgentSnapshot(home);
    expect(getAgentSkillsDir(home, "codex")).toBeDefined();
    const retained = await scanInstalledSkills(home);
    expect(retained).toHaveLength(1);
    expect(retained[0]).toMatchObject({ id: original!.id, origin: "external", starred: true, isMine: true, apps: { codex: true } });
    expect((await archiveSkillRefs(home, [original!.id])).archived).toEqual([]);
    expect(await fs.readFile(path.join(root, "SKILL.md"), "utf8")).toBe("# Demo");
  });

  it("suppresses missing nested and aliased defaults while retaining unrelated agents", async () => {
    for (const relative of [".codex", ".codex/skills", ".codex/skills/nested"]) {
      const home = await makeTempHome();
      const config = path.join(home, ".skill-zoo");
      await fs.mkdir(config, { recursive: true });
      await fs.writeFile(path.join(config, "agents.json"), JSON.stringify({ version: 1, agents: [{
        id: "custom-11111111-1111-4111-a111-111111111111", label: "Tool", skillsDir: path.join(home, relative),
      }] }));
      expect(getAgentSkillsDir(home, "codex")).toBeUndefined();
      expect(getAgentSkillsDir(home, "claude-code")).toBeDefined();
    }
    const home = await makeTempHome();
    const config = path.join(home, ".skill-zoo");
    const root = path.join(home, "original");
    await fs.mkdir(config, { recursive: true });
    await fs.mkdir(root);
    await fs.symlink(root, path.join(home, ".codex"), process.platform === "win32" ? "junction" : "dir");
    await fs.writeFile(path.join(config, "agents.json"), JSON.stringify({ version: 1, agents: [{
      id: "custom-11111111-1111-4111-a111-111111111111", label: "Tool", skillsDir: path.join(root, "skills"),
    }] }));
    expect(getAgentSkillsDir(home, "codex")).toBeUndefined();
  });

  it("resolves arbitrary custom directories using one command snapshot", async () => {
    const home = await makeTempHome();
    const dir = path.join(home, ".skill-zoo");
    await fs.mkdir(dir, { recursive: true });
    const full = await fixture(process.platform === "win32" ? "agents-v1-windows-full.json" : "agents-v1-full.json");
    full.agents[0].skillsDir = path.join(home, "tool/skills");
    await fs.writeFile(path.join(dir, "agents.json"), JSON.stringify(full));
    const snapshot = getAgents(home);
    expect(snapshot).toBe(getAgents(home));
    expect(snapshot).toHaveLength(AGENTS.length + 1);
    expect(getAgentSkillsDir(home, full.agents[0].id)).toBe(full.agents[0].skillsDir);
  });

  it("preserves native skill management and restores after the home registration is removed", async () => {
    const home = await makeTempHome();
    const dir = path.join(home, ".skill-zoo");
    const full = await fixture(process.platform === "win32" ? "agents-v1-windows-full.json" : "agents-v1-full.json");
    const agent = full.agents[0];
    agent.skillsDir = path.join(home, "tool/skills");
    const skillRoot = path.join(agent.skillsDir, ".system/demo");
    await fs.mkdir(skillRoot, { recursive: true });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "agents.json"), JSON.stringify(full));
    await fs.writeFile(path.join(skillRoot, "SKILL.md"), "# Original skill");
    const [installed] = await scanInstalledSkills(home);
    expect(installed).toMatchObject({ origin: "agent", homeAgent: agent.id, apps: { [agent.id]: true } });
    await writeMetadata(home, { entries: { [installed!.id]: { starred: true, isMine: true } } });
    expect((await archiveSkillRefs(home, [installed!.id])).failed).toEqual([]);
    const [archived] = await listArchivedSkills(home);
    // These writes represent the desktop's protocol-defined file-preserving
    // removal, not a CLI-owned alternate registration schema.
    await writeExternalImports(home, { version: 1, imports: { [installed!.id]: {
      id: installed!.id, sourcePath: skillRoot, directory: installed!.directory,
      importedAt: installed!.installedAt, updatedAt: installed!.updatedAt,
    } } });
    await fs.writeFile(path.join(dir, "agents.json"), JSON.stringify({ version: 1, agents: [] }));
    resetAgentSnapshot(home);
    const restored = await restoreArchiveIds(home, [archived!.archiveId]);
    expect(restored.failed).toEqual([]);
    expect(restored.skippedAgents).toContain(agent.id);
    expect(await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")).toBe("# Original skill");
    const [retained] = await scanInstalledSkills(home);
    expect(retained).toMatchObject({ id: installed!.id, origin: "external", starred: true, isMine: true });
  });

  it("does not duplicate an existing external import when a custom root encloses it", async () => {
    const home = await makeTempHome();
    const dir = path.join(home, ".skill-zoo");
    const full = await fixture(process.platform === "win32" ? "agents-v1-windows-full.json" : "agents-v1-full.json");
    full.agents[0].skillsDir = path.join(home, "tool/skills");
    const root = path.join(full.agents[0].skillsDir, "demo");
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "agents.json"), JSON.stringify(full));
    await fs.writeFile(path.join(root, "SKILL.md"), "# Demo");
    await writeExternalImports(home, { version: 1, imports: { "external:demo": {
      id: "external:demo", sourcePath: root, directory: "demo", importedAt: 1, updatedAt: 1,
    } } });
    const installed = await scanInstalledSkills(home);
    expect(installed).toHaveLength(1);
    expect(installed[0]).toMatchObject({ id: "external:demo", origin: "external", apps: { [full.agents[0].id]: true } });
    expect((await archiveSkillRefs(home, ["external:demo"])).archived).toEqual([]);
    expect(await fs.readFile(path.join(root, "SKILL.md"), "utf8")).toBe("# Demo");
  });

  it("holds an exclusive crash-released lease", async () => {
    const home = await makeTempHome();
    const release = await acquireAgentLease(home);
    try { await expect(acquireAgentLease(home)).rejects.toThrow("operation"); }
    finally { await release(); }
    const again = await acquireAgentLease(home);
    await again();
  });

  it("replays shared committed and uncommitted lifecycle fixtures", async () => {
    for (const committed of [false, true]) {
      const home = await makeTempHome();
      const dir = path.join(home, ".skill-zoo");
      await fs.mkdir(dir, { recursive: true });
      const journal = await fixture(`agent-lifecycle-v1-${committed ? "committed" : "pending"}.json`);
      await fs.writeFile(path.join(dir, "agent-lifecycle.json"), JSON.stringify(journal));
      await fs.writeFile(path.join(dir, "settings.json"), "partial");
      await recoverAgentLifecycle(dir);
      expect(await fs.readFile(path.join(dir, "settings.json"), "utf8")).toBe(committed ? journal.after["settings.json"] : journal.before["settings.json"]);
      const settings = JSON.parse(await fs.readFile(path.join(dir, "settings.json"), "utf8"));
      expect(settings.values.hide_non_ssot).toBe("true");
      expect(settings.values.show_non_ssot).toBe(committed ? "true" : undefined);
      await expect(fs.access(path.join(dir, "agent-lifecycle.json"))).rejects.toThrow();
    }
  });

  it("retains a failed recovery journal and retries every shared replay prefix", async () => {
    for (const committed of [false, true]) {
      const journal = await fixture(`agent-lifecycle-v1-${committed ? "committed" : "pending"}.json`);
      const snapshot = (committed ? journal.after : journal.before) as Record<string, string | null>;
      const entries = Object.entries(snapshot);
      for (let failAt = 0; failAt < entries.length; failAt++) {
        const home = await makeTempHome();
        try {
          const dir = path.join(home, ".skill-zoo");
          await fs.mkdir(dir);
          const journalPath = path.join(dir, "agent-lifecycle.json");
          const bytes = JSON.stringify(journal);
          await fs.writeFile(journalPath, bytes);
          await fs.writeFile(path.join(dir, "unrelated.txt"), "keep");
          for (const [index, [name]] of entries.entries()) {
            if (index === failAt) await fs.mkdir(path.join(dir, name));
            else await fs.writeFile(path.join(dir, name), `partial:${name}`);
          }
          const read = (name: string) => fs.readFile(path.join(dir, name), "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
          for (let attempt = 0; attempt < 2; attempt++) {
            await expect(recoverAgentLifecycle(dir)).rejects.toThrow();
            expect(await fs.readFile(journalPath, "utf8")).toBe(bytes);
            for (const [index, [name, content]] of entries.entries()) {
              if (index < failAt) expect(await read(name)).toBe(content);
              else if (index === failAt) expect((await fs.stat(path.join(dir, name))).isDirectory()).toBe(true);
              else expect(await read(name)).toBe(`partial:${name}`);
            }
          }
          await fs.rmdir(path.join(dir, entries[failAt]![0]));
          await recoverAgentLifecycle(dir);
          await expect(fs.access(journalPath)).rejects.toThrow();
          await recoverAgentLifecycle(dir);
          for (const [name, content] of entries) expect(await read(name)).toBe(content);
          expect(await read("unrelated.txt")).toBe("keep");
        } finally {
          await fs.rm(home, { recursive: true, force: true });
        }
      }
    }
  });

  it("releases the CLI lease when recovery fails so recovery can be retried", async () => {
    const home = await makeTempHome();
    let release: (() => Promise<void>) | undefined;
    try {
      const dir = path.join(home, ".skill-zoo");
      await fs.mkdir(dir);
      const journal = await fixture("agent-lifecycle-v1-committed.json");
      const journalPath = path.join(dir, "agent-lifecycle.json");
      const bytes = JSON.stringify(journal);
      await fs.writeFile(journalPath, bytes);
      const blocked = path.join(dir, "settings.json");
      await fs.mkdir(blocked);
      await expect(acquireAgentLease(home).then((unlock) => { release = unlock; })).rejects.toThrow();
      expect(await fs.readFile(journalPath, "utf8")).toBe(bytes);

      await fs.rmdir(blocked);
      release = await acquireAgentLease(home);
      expect(await fs.readFile(blocked, "utf8")).toBe(journal.after["settings.json"]);
      await expect(fs.access(journalPath)).rejects.toThrow();
    } finally {
      await release?.();
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});
