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
  await fs.writeFile(tmpPath, content);
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

export async function createAgentLink(linkPath: string, targetPath: string): Promise<void> {
  await ensureDir(path.dirname(linkPath));
  await removePath(linkPath);
  await fs.symlink(targetPath, linkPath, process.platform === "win32" ? "junction" : "dir");
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
