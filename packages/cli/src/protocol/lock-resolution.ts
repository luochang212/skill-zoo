import { isDeepStrictEqual } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getAgents } from "./custom-agents.js";
import { getAgentSkillsDir, getPaths } from "./paths.js";
import { SKIP_DIRS } from "./agents.js";
import { readExternalImports } from "./store.js";
import { isSymlinkOrJunction } from "../lib/io.js";
import type { SkillLock, SkillLockEntry } from "./types.js";

export interface Installation {
  owningRoot: string;
  installDirectory: string;
  homePath: string;
  origin: "ssot" | "agent" | "external";
  provenance:
    | { kind: "Absent" }
    | { kind: "Tracking"; repo?: string; path?: string }
    | { kind: "Unreadable"; reason: string };
}
export type LockResolution =
  | { kind: "Resolved"; lockKey: string; entry: SkillLockEntry }
  | { kind: "Missing"; reason: string }
  | {
      kind: "Ambiguous";
      reason: string;
      candidates: { lockKey: string; physicalDirectories: string[]; reason: string }[];
    };

export function normalizeLockSkillPath(raw: string): string {
  const value = raw.replaceAll("\\", "/");
  if (value.startsWith("/") || value.includes(":") || value.split("/").includes(".."))
    throw new Error(`Unsupported skillPath: ${raw}`);
  const parts = value.split("/").filter((p) => p && p !== ".");
  if (parts.at(-1) === "SKILL.md") parts.pop();
  return parts.join("/");
}
function githubRepo(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    const repo = url.pathname
      .replace(/\/$/, "")
      .replace(/^\//, "")
      .replace(/\.git$/, "");
    if (
      url.username !== "" ||
      url.password !== "" ||
      (url.port !== "" && url.port !== "443") ||
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.search ||
      url.hash ||
      !/^[^/]+\/[^/]+$/.test(repo)
    )
      return;
    return repo.toLowerCase();
  } catch {
    return;
  }
}
function corroborates(target: Installation, entry: SkillLockEntry): boolean | undefined {
  if (
    target.provenance.kind !== "Tracking" ||
    target.provenance.repo == null ||
    target.provenance.path == null
  )
    return;
  const repo = githubRepo(target.provenance.repo);
  if (!repo) return;
  let evidencePath: string;
  try {
    evidencePath = normalizeLockSkillPath(target.provenance.path);
  } catch {
    return;
  }
  try {
    return (
      entry.source?.toLowerCase() === repo &&
      (entry.sourceUrl == null || githubRepo(entry.sourceUrl) === repo) &&
      entry.skillPath != null &&
      normalizeLockSkillPath(entry.skillPath) === evidencePath
    );
  } catch {
    return false;
  }
}
function candidate(target: Installation, key: string, entry: SkillLockEntry): boolean {
  if (target.origin === "external") return false;
  const leaf = target.installDirectory.split("/").at(-1);
  return (
    (target.origin === "ssot" && (key === target.installDirectory || key === leaf)) ||
    (corroborates(target, entry) === true &&
      ((key.includes("/") &&
        key.split("/").every((part) => part && part !== "." && part !== "..") &&
        !key.includes("\\") &&
        key.split("/").at(-1) === leaf) ||
        (target.origin === "agent" && (key === target.installDirectory || key === leaf))))
  );
}
export function resolveInstallationLock(
  target: Installation,
  inventory: Installation[],
  lock: SkillLock,
): LockResolution {
  if (target.origin === "external") return { kind: "Missing", reason: "outsideLockScope" };
  const candidates = Object.entries(lock.skills).filter(([key, entry]) =>
    candidate(target, key, entry),
  );
  const evidence = (reason: string) =>
    candidates.map(([lockKey, entry]) => ({
      lockKey,
      reason,
      physicalDirectories: inventory
        .filter((item) => candidate(item, lockKey, entry))
        .map((item) => item.homePath),
    }));
  if (candidates.length > 1)
    return {
      kind: "Ambiguous",
      reason: "multipleEntries",
      candidates: evidence("multipleEntries"),
    };
  const found = candidates[0];
  if (!found)
    return {
      kind: "Missing",
      reason: Object.keys(lock.skills).length ? "noCorroboratedAssociation" : "noEntry",
    };
  const [lockKey, entry] = found;
  if (corroborates(target, entry) === false)
    return {
      kind: "Ambiguous",
      reason: "conflictingEvidence",
      candidates: evidence("conflictingEvidence"),
    };
  if (
    inventory.some(
      (other) => other.homePath !== target.homePath && candidate(other, lockKey, entry),
    )
  )
    return { kind: "Ambiguous", reason: "sharedEntry", candidates: evidence("sharedEntry") };
  return { kind: "Resolved", lockKey, entry: structuredClone(entry) };
}
export async function installationEvidence(
  owningRoot: string,
  directory: string,
  origin: Installation["origin"],
): Promise<Installation> {
  const homePath = await fs.realpath(directory);
  const realRoot = await fs.realpath(owningRoot);
  const relative = path.relative(realRoot, homePath);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`Installation outside root: ${directory}`);
  const bytes = await fs.readFile(path.join(directory, "SKILL.md"));
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch (error) {
    return {
      owningRoot,
      installDirectory: path.relative(owningRoot, directory).replaceAll("\\", "/"),
      homePath,
      origin,
      provenance: { kind: "Unreadable", reason: String(error) },
    };
  }
  const lines = text.split(/\r?\n/);
  while (lines[0]?.trim() === "") lines.shift();
  let provenance: Installation["provenance"] = { kind: "Absent" };
  if (lines.shift()?.trimEnd() === "---") {
    const end = lines.findIndex((line) => line.trimEnd() === "---");
    if (end >= 0) {
      const doc = YAML.parseDocument(lines.slice(0, end).join("\n"), {
        merge: true,
        uniqueKeys: true,
      });
      if (doc.errors.length || doc.warnings.length)
        provenance = { kind: "Unreadable", reason: "Unsafe YAML" };
      else {
        try {
          const metadata = doc.toJS()?.metadata;
          const reserved = [
            "github-repo",
            "github-path",
            "github-ref",
            "github-tree-sha",
            "github-pinned",
            "github-owner",
            "github-sha",
          ];
          if (
            metadata &&
            typeof metadata === "object" &&
            !Array.isArray(metadata) &&
            reserved.some((key) => Object.hasOwn(metadata, key))
          ) {
            provenance = {
              kind: "Tracking",
              repo:
                typeof metadata["github-repo"] === "string" ? metadata["github-repo"] : undefined,
              path:
                typeof metadata["github-path"] === "string" ? metadata["github-path"] : undefined,
            };
          }
        } catch (error) {
          provenance = { kind: "Unreadable", reason: String(error) };
        }
      }
    } else provenance = { kind: "Unreadable", reason: "Unclosed YAML frontmatter" };
  }
  return {
    owningRoot,
    installDirectory: path.relative(owningRoot, directory).replaceAll("\\", "/"),
    homePath,
    origin,
    provenance,
  };
}
export async function collectInstallations(home?: string): Promise<Installation[]> {
  const result: Installation[] = [];
  async function walk(root: string, directory: string, origin: Installation["origin"]) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (directory === root && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (
        !entry.isDirectory() ||
        (await isSymlinkOrJunction(target)) ||
        SKIP_DIRS.has(entry.name) ||
        (entry.name.startsWith(".") &&
          [".install.", ".update.", ".backup."].some((marker) => entry.name.includes(marker)))
      )
        continue;
      try {
        await fs.access(path.join(target, "SKILL.md"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          await walk(root, target, origin);
          continue;
        }
        throw error;
      }
      const item = await installationEvidence(root, target, origin);
      if (!result.some((other) => other.homePath === item.homePath)) result.push(item);
    }
  }
  const ssot = getPaths(home).agentsSkillsDir;
  await walk(ssot, ssot, "ssot");
  for (const agent of getAgents(home)) {
    const root = getAgentSkillsDir(home, agent.id);
    if (root) await walk(root, root, "agent");
  }
  const external = new Set<string>();
  for (const entry of Object.values((await readExternalImports(home)).imports)) {
    try {
      external.add(await fs.realpath(entry.sourcePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return result.filter((item) => !external.has(item.homePath));
}
export async function resolveHomeLock(
  home: string | undefined,
  homePath: string,
  origin: string,
  lock: SkillLock,
): Promise<LockResolution> {
  if (origin === "external") return { kind: "Missing", reason: "outsideLockScope" };
  const inventory = await collectInstallations(home);
  const real = await fs.realpath(homePath);
  const target = inventory.find((item) => item.homePath === real);
  if (!target) throw new Error(`Installation not in inventory: ${homePath}`);
  const resolution = resolveInstallationLock(target, inventory, lock);
  if (resolution.kind === "Ambiguous")
    throw new Error(
      `lockAmbiguous: ${resolution.reason}: ${resolution.candidates.map((candidate) => `${candidate.lockKey} [${candidate.physicalDirectories.join(", ")}] (${candidate.reason})`).join(", ")}`,
    );
  return resolution;
}

export function lockEntriesEqual(left: SkillLockEntry, right: SkillLockEntry): boolean {
  const defaults = Object.fromEntries(
    [
      "source",
      "sourceType",
      "sourceUrl",
      "ref",
      "skillPath",
      "skillFolderHash",
      "commitSha",
      "installedAt",
      "updatedAt",
      "pinnedRef",
    ].map((key) => [key, null]),
  );
  return isDeepStrictEqual({ ...defaults, ...left }, { ...defaults, ...right });
}
