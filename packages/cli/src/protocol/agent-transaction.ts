import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import { CliError } from "../lib/errors.js";
import { getPaths } from "./paths.js";
import { resetAgentSnapshot } from "./custom-agents.js";

const files = new Set(["agents.json", "imports.json", "settings.json", "metadata.json"]);
interface Journal {
  version: number;
  committed: boolean;
  before: Record<string, string | null>;
  after: Record<string, string | null>;
}

export async function recoverAgentLifecycle(dir: string): Promise<void> {
  const journalPath = path.join(dir, "agent-lifecycle.json");
  let journal: Journal;
  try {
    journal = JSON.parse(await fs.readFile(journalPath, "utf8")) as Journal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (journal.version !== 1) throw new CliError("Upgrade Skill Zoo to recover this agent lifecycle");
  if (typeof journal.committed !== "boolean" || !journal.before || !journal.after) throw new CliError("Invalid lifecycle journal");
  for (const snapshot of [journal.before, journal.after]) {
    for (const [name, content] of Object.entries(snapshot)) {
      if (!files.has(name) || (content !== null && typeof content !== "string")) throw new CliError("Invalid lifecycle journal filename or content");
    }
  }
  for (const [name, content] of Object.entries(journal.committed ? journal.after : journal.before)) {
    const target = path.join(dir, name);
    if (content === null) {
      await fs.rm(target, { force: true });
    } else {
      // Preserve original snapshot bytes, not a reserialized JSON object.
      const temporary = `${target}.tmp`;
      const file = await fs.open(temporary, "w");
      try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
      await fs.rename(temporary, target);
    }
  }
  await fs.rm(journalPath);
}

export async function acquireAgentLease(home?: string): Promise<() => Promise<void>> {
  const dir = getPaths(home).appConfigDir;
  await fs.mkdir(dir, { recursive: true });
  let identity: string;
  if (process.platform === "win32") identity = (await fs.realpath(dir)).replaceAll("\\", "/").replace(/^\/\/\?\//, "").toLowerCase();
  else { const metadata = await fs.stat(dir, { bigint: true }); identity = `unix:${metadata.dev}:${metadata.ino}`; }
  const digest = crypto.createHash("sha256").update(identity).digest();
  const port = 10240 + digest.readUInt16BE(0) % 16384;
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", () => reject(new CliError("Another agent operation is running or the local lease is unavailable. Try again when it finishes.")));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
  });
  const release = () => new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    await recoverAgentLifecycle(dir);
    resetAgentSnapshot(home);
  } catch (error) {
    await release();
    throw error;
  }
  return release;
}
