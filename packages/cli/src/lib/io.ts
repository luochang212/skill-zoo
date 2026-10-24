import { promises as fs } from "node:fs";
import path from "node:path";

export interface FileSnapshot {
  path: string;
  exists: boolean;
  content?: string;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function lstatSafe(filePath: string) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function isSymlinkOrJunction(filePath: string): Promise<boolean> {
  const stat = await lstatSafe(filePath);
  return stat?.isSymbolicLink() ?? false;
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    // The desktop tolerates empty/whitespace state files as "absent"; the CLI
    // must be at least as tolerant as the owner of these files.
    if (!content.trim()) {
      return structuredClone(fallback);
    }
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return structuredClone(fallback);
    }
    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  const parent = path.dirname(filePath);
  await ensureDir(parent);
  const tmpPath = path.join(parent, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  // Match the desktop's atomic write: flush the temp file to disk before the
  // rename so a crash cannot leave a truncated state file behind.
  const file = await fs.open(tmpPath, "w");
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
  await fs.rename(tmpPath, filePath);
}

export async function removePath(filePath: string): Promise<void> {
  await fs.rm(filePath, { recursive: true, force: true });
}

export async function movePath(source: string, destination: string): Promise<void> {
  await ensureDir(path.dirname(destination));
  await fs.rename(source, destination);
}

export async function snapshotFile(filePath: string): Promise<FileSnapshot> {
  try {
    return {
      path: filePath,
      exists: true,
      content: await fs.readFile(filePath, "utf8"),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: filePath, exists: false };
    }
    throw error;
  }
}

export async function restoreSnapshot(snapshot: FileSnapshot): Promise<void> {
  if (snapshot.exists) {
    await writeTextAtomic(snapshot.path, snapshot.content ?? "");
  } else {
    await removePath(snapshot.path);
  }
}

export async function realpathOrOriginal(filePath: string): Promise<string> {
  try {
    return await fs.realpath(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

export async function pathsEqual(left: string, right: string): Promise<boolean> {
  return (await realpathOrOriginal(left)) === (await realpathOrOriginal(right));
}

export async function pathStartsWith(candidate: string, root: string): Promise<boolean> {
  const realCandidate = await realpathOrOriginal(candidate);
  const realRoot = await realpathOrOriginal(root);
  const relative = path.relative(realRoot, realCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function assertAgentLinkAvailable(linkPath: string, targetPath: string): Promise<void> {
  const existing = await lstatSafe(linkPath);
  if (!existing) return;
  const isLink = await isSymlinkOrJunction(linkPath);
  if (isLink && await pathsEqual(linkPath, targetPath)) return;
  const hint = isLink
    ? "it points at a different target; remove it or repair it with `skill-zoo doctor fix`"
    : "move or remove it first";
  throw new Error(`Cannot create agent link: ${linkPath} already exists; ${hint}.`);
}

export async function createAgentLink(linkPath: string, targetPath: string): Promise<boolean> {
  await assertAgentLinkAvailable(linkPath, targetPath);
  if (await lstatSafe(linkPath)) return false;
  await ensureDir(path.dirname(linkPath));
  await fs.symlink(targetPath, linkPath, process.platform === "win32" ? "junction" : "dir");
  return true;
}

/**
 * Replace an existing symlink with one pointing at targetPath. Callers must
 * have verified the path is a symlink (never an entity directory). This is
 * the repair path for invalid links, not a general overwrite primitive.
 */
export async function replaceAgentLink(linkPath: string, targetPath: string): Promise<boolean> {
  if (await isSymlinkOrJunction(linkPath)) {
    await removePath(linkPath);
  }
  return createAgentLink(linkPath, targetPath);
}

/** Normalize path separators to forward slashes for cross-platform consistency
 *  with the Rust/Tauri desktop app (`normalize_path_separators`). */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export async function removeAgentLink(linkPath: string): Promise<boolean> {
  if (!(await isSymlinkOrJunction(linkPath))) {
    return false;
  }
  await removePath(linkPath);
  return true;
}
