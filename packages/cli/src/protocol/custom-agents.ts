import { readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENTS, type AgentConfig } from "./agents.js";
import { CliError } from "../lib/errors.js";

export interface CustomAgent {
  id: string;
  label: string;
  skillsDir: string;
}

export interface AgentRegistry {
  version: 1;
  agents: CustomAgent[];
}

export function parseAgentRegistry(input: unknown): AgentRegistry {
  if (!input || typeof input !== "object") throw new CliError("Invalid agents.json");
  const registry = input as Record<string, unknown>;
  if (typeof registry.version === "number" && registry.version > 1) {
    throw new CliError("Upgrade Skill Zoo to read this agent registry");
  }
  if (registry.version !== 1 || (registry.agents !== undefined && !Array.isArray(registry.agents))) {
    throw new CliError("Invalid agent registry version or agents list");
  }
  const ids = new Set<string>();
  const labels = new Set<string>();
  const agents: CustomAgent[] = [];
  for (const value of (registry.agents ?? []) as unknown[]) {
    if (!value || typeof value !== "object") throw new CliError("Invalid custom agent");
    const a = value as Record<string, unknown>;
    if (typeof a.id !== "string" || !/^custom-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(a.id) || ids.has(a.id)) {
      throw new CliError("Invalid or duplicate custom agent ID");
    }
    if (typeof a.label !== "string" || !a.label || a.label.trim() !== a.label || [...a.label].length > 64 || labels.has(a.label.toLowerCase())) {
      throw new CliError("Invalid or duplicate agent name");
    }
    if (typeof a.skillsDir !== "string" || (!path.isAbsolute(a.skillsDir) || (process.platform === "win32" && !path.parse(a.skillsDir).root.match(/^(?:[A-Za-z]:|\\\\)/)))) throw new CliError("Agent Skills directory must be absolute");
    ids.add(a.id);
    labels.add(a.label.toLowerCase());
    agents.push({ id: a.id, label: a.label, skillsDir: a.skillsDir });
  }
  return { version: 1, agents };
}

export interface SuppressedAgent extends AgentConfig { suppressedBy: string; }
interface AgentSnapshot { agents: AgentConfig[]; suppressed: SuppressedAgent[]; }
const snapshots = new Map<string, AgentSnapshot>();

// Resolve existing ancestors too: a default root may not have been created yet.
function resolvedRoot(input: string): string {
  try { return realpathSync.native(input); }
  catch { const parent = path.dirname(input); return parent === input ? input : path.join(resolvedRoot(parent), path.basename(input)); }
}
function directoryIdentity(input: string): string | undefined {
  try { const stat = statSync(input, { bigint: true }); return `${stat.dev}:${stat.ino}`; }
  catch { return undefined; }
}
function contains(root: string, target: string): boolean {
  const compare = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  const relative = path.relative(compare(root), compare(target));
  if (!relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))) return true;
  const ancestors = new Map<string, string>();
  for (let cursor = root; ; cursor = path.dirname(cursor)) {
    const key = directoryIdentity(cursor);
    if (key) ancestors.set(key, compare(path.relative(cursor, root)));
    if (path.dirname(cursor) === cursor) break;
  }
  for (let cursor = target; ; cursor = path.dirname(cursor)) {
    const key = directoryIdentity(cursor);
    const leftTail = key ? ancestors.get(key) : undefined;
    if (leftTail !== undefined) {
      const rightTail = compare(path.relative(cursor, target));
      const tail = path.relative(leftTail || ".", rightTail || ".");
      if (!tail || (!path.isAbsolute(tail) && tail !== ".." && !tail.startsWith(`..${path.sep}`))) return true;
    }
    if (path.dirname(cursor) === cursor) return false;
  }
}

export function resolveAgentRegistry(home: string, custom: CustomAgent[], builtins: AgentConfig[] = AGENTS): AgentSnapshot {
  if (custom.length === 0) return { agents: [...builtins], suppressed: [] };
  const agents: AgentConfig[] = [];
  const suppressed: SuppressedAgent[] = [];
  const roots = custom.map((a) => ({ agent: a, root: resolvedRoot(a.skillsDir) }));
  for (const builtin of builtins) {
    const root = resolvedRoot(builtin.skillsDir ?? path.join(home, builtin.skillsSubdir, "skills"));
    const conflict = roots.find((a) => contains(root, a.root) || contains(a.root, root));
    if (conflict) suppressed.push({ ...builtin, suppressedBy: conflict.agent.id });
    else agents.push(builtin);
  }
  agents.push(...custom.map((a) => ({ ...a, skillsSubdir: "" })));
  return { agents, suppressed };
}

// A command keeps a single registry snapshot for all of its per-skill lookups.
export function getAgents(home?: string): AgentConfig[] {
  const resolvedHome = path.resolve(home ?? os.homedir());
  const cached = snapshots.get(resolvedHome);
  if (cached) return cached.agents;
  let custom: CustomAgent[] = [];
  try {
    custom = parseAgentRegistry(JSON.parse(readFileSync(path.join(resolvedHome, ".skill-zoo/agents.json"), "utf8"))).agents;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (error instanceof CliError) throw error;
      throw new CliError(`Cannot read agents.json: ${String(error)}`);
    }
  }
  const snapshot = resolveAgentRegistry(resolvedHome, custom);
  snapshots.set(resolvedHome, snapshot);
  return snapshot.agents;
}

export function getSuppressedAgents(home?: string): SuppressedAgent[] {
  getAgents(home);
  return snapshots.get(path.resolve(home ?? os.homedir()))!.suppressed;
}

export function resetAgentSnapshot(home?: string): void {
  snapshots.delete(path.resolve(home ?? os.homedir()));
}
