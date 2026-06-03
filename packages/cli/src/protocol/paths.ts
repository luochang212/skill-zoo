import os from "node:os";
import path from "node:path";
import { AGENTS } from "./agents.js";

export interface SkillZooPaths {
  home: string;
  appConfigDir: string;
  agentsSkillsDir: string;
  agentLockFile: string;
  archiveDir: string;
  archiveSkillsDir: string;
  archiveManifestFile: string;
  metadataFile: string;
  skillsCacheFile: string;
  hashCacheFile: string;
}

export interface AgentPathInfo {
  agent: string;
  label: string;
  path: string;
  exists?: boolean;
}

export function resolveHome(home?: string): string {
  return path.resolve(home ?? os.homedir());
}

export function getPaths(homeInput?: string): SkillZooPaths {
  const home = resolveHome(homeInput);
  const appConfigDir = path.join(home, ".skill-zoo");
  const agentsDir = path.join(home, ".agents");
  const archiveDir = path.join(appConfigDir, "archive");

  return {
    home,
    appConfigDir,
    agentsSkillsDir: path.join(agentsDir, "skills"),
    agentLockFile: path.join(agentsDir, ".skill-lock.json"),
    archiveDir,
    archiveSkillsDir: path.join(archiveDir, "skills"),
    archiveManifestFile: path.join(archiveDir, "manifest.json"),
    metadataFile: path.join(appConfigDir, "metadata.json"),
    skillsCacheFile: path.join(appConfigDir, "skills-cache.json"),
    hashCacheFile: path.join(appConfigDir, "hash-cache.json"),
  };
}

export function getAgentSkillsDir(homeInput: string | undefined, agentId: string): string | undefined {
  if (agentId === "ssot") {
    return getPaths(homeInput).agentsSkillsDir;
  }

  const agent = AGENTS.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return undefined;
  }

  return path.join(resolveHome(homeInput), agent.skillsSubdir, "skills");
}

export function getAllAgentPaths(homeInput?: string): AgentPathInfo[] {
  const paths = getPaths(homeInput);
  return [
    { agent: "ssot", label: "Skills Store", path: paths.agentsSkillsDir },
    ...AGENTS.map((agent) => ({
      agent: agent.id,
      label: agent.label,
      path: path.join(paths.home, agent.skillsSubdir, "skills"),
    })),
  ];
}
