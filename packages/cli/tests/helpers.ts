import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export async function makeTempHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "skill-zoo-cli-"));
}

export async function writeSkill(skillDir: string, frontmatter = "name: test-skill\ndescription: Test skill") {
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), `---\n${frontmatter}\n---\n\n# Skill\n`);
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function createDirLink(target: string, linkPath: string): Promise<void> {
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  await fs.symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}
