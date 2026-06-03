import { promises as fs } from "node:fs";
import path from "node:path";
import { CliError } from "../lib/errors.js";
import { pathExists } from "../lib/io.js";
import { listArchivedSkills } from "./archive.js";
import { getPaths } from "./paths.js";
import { resolveOneSkillRef } from "./refs.js";
import { scanInstalledSkills } from "./scan.js";

export async function readInstalledSkillMd(home: string | undefined, ref: string): Promise<string> {
  const skill = resolveOneSkillRef(await scanInstalledSkills(home), ref);
  if (!skill.homePath) {
    throw new CliError(`Skill has no readable home path: ${ref}`);
  }

  const skillMd = path.join(skill.homePath, "SKILL.md");
  if (!(await pathExists(skillMd))) {
    throw new CliError(`SKILL.md not found for skill: ${ref}`);
  }

  return fs.readFile(skillMd, "utf8");
}

export async function readArchivedSkillMd(home: string | undefined, archiveId: string): Promise<string> {
  const skill = (await listArchivedSkills(home)).find((candidate) => candidate.archiveId === archiveId);
  if (!skill) {
    throw new CliError(`Archived skill not found: ${archiveId}`);
  }

  const skillMd = path.join(getPaths(home).archiveSkillsDir, archiveId, "SKILL.md");
  if (!(await pathExists(skillMd))) {
    throw new CliError(`Archived SKILL.md not found: ${archiveId}`);
  }

  return fs.readFile(skillMd, "utf8");
}
