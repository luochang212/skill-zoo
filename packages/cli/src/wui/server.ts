import crypto from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { archiveSkillRefs, listArchivedSkills, restoreArchiveIds } from "../protocol/archive.js";
import { inspectArchivedSkill, inspectInstalledSkill, runDoctor } from "../protocol/diagnostics.js";
import { getAllAgentPaths } from "../protocol/paths.js";
import { rebuildCache, scanInstalledSkills } from "../protocol/scan.js";
import { readArchivedSkillMd, readInstalledSkillMd } from "../protocol/content.js";
import { CliError, messageFromError } from "../lib/errors.js";
import { pathExists } from "../lib/io.js";
import { jsonEnvelope, type JsonEnvelope } from "../output.js";

export const DEFAULT_WUI_PORT = 8280;
export const WUI_HOST = "127.0.0.1";
const TOKEN_HEADER = "x-skill-zoo-token";

export interface WuiServerOptions {
  home?: string;
  port?: number;
  token?: string;
  assetDir?: string;
}

export interface WuiServerHandle {
  server: Server;
  url: string;
  port: number;
  token: string;
  close: () => Promise<void>;
}

interface RequestContext {
  home?: string;
  token: string;
}

export function parseWuiPort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new CliError(`Invalid port: ${value}`);
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliError(`Invalid port: ${value}`);
  }

  return port;
}

export async function startWuiServer(options: WuiServerOptions = {}): Promise<WuiServerHandle> {
  const assetDir = options.assetDir ?? defaultAssetDir();
  if (!(await pathExists(path.join(assetDir, "index.html")))) {
    throw new CliError(`WUI assets not found at ${assetDir}. Run the local WUI build/setup step first.`);
  }

  const token = options.token ?? crypto.randomBytes(18).toString("base64url");
  const server = createServer((request, response) => {
    void handleRequest(request, response, assetDir, { home: options.home, token });
  });
  const port = options.port ?? DEFAULT_WUI_PORT;

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      if (error.code === "EADDRINUSE") {
        reject(new CliError(`Port ${port} is already in use. Choose another port with --port.`));
      } else {
        reject(error);
      }
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, WUI_HOST);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${WUI_HOST}:${actualPort}/?token=${encodeURIComponent(token)}`;

  return {
    server,
    url,
    port: actualPort,
    token,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {
    // Opening the browser is a convenience; the server URL is already printed.
  });
  child.unref();
}

export function waitForWuiShutdown(server: Server): Promise<void> {
  return new Promise((resolve) => {
    const shutdown = () => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      server.close(() => resolve());
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

function defaultAssetDir(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDir, "../wui"),
    path.resolve(moduleDir, "../../wui"),
    path.resolve(process.cwd(), "packages/cli/wui"),
    path.resolve(process.cwd(), "wui"),
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, "index.html"))) ?? candidates[0]!;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  assetDir: string,
  context: RequestContext,
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", `http://${WUI_HOST}`);
    if (url.pathname.startsWith("/api/")) {
      if (!isAuthorized(request, context.token)) {
        writeJson(response, 401, { ok: false, error: "Unauthorized" });
        return;
      }
      await handleApi(request, response, url, context);
      return;
    }

    await serveStatic(response, assetDir, url.pathname);
  } catch (error) {
    writeJson(response, error instanceof CliError ? 400 : 500, { ok: false, error: messageFromError(error) });
  }
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: RequestContext,
): Promise<void> {
  const method = request.method ?? "GET";

  if (method === "GET" && url.pathname === "/api/state") {
    const [installed, archived, doctor, paths] = await Promise.all([
      scanInstalledSkills(context.home),
      listArchivedSkills(context.home),
      runDoctor(context.home),
      Promise.resolve(getAllAgentPaths(context.home)),
    ]);
    writeOk(response, {
      installed,
      archived,
      doctor,
      paths,
      status: {
        installedCount: installed.length,
        archivedCount: archived.length,
        doctorStatus: doctor.status,
      },
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/refresh") {
    const installed = await rebuildCache(context.home);
    writeOk(response, { installedCount: installed.length, refreshed: true });
    return;
  }

  if (method === "GET" && url.pathname === "/api/doctor") {
    writeOk(response, await runDoctor(context.home));
    return;
  }

  if (method === "GET" && url.pathname === "/api/inspect") {
    const kind = url.searchParams.get("kind");
    const ref = url.searchParams.get("ref");
    if (!ref) {
      throw new CliError("Missing skill ref.");
    }
    const data = kind === "archived"
      ? await inspectArchivedSkill(context.home, ref)
      : await inspectInstalledSkill(context.home, ref);
    writeOk(response, data);
    return;
  }

  if (method === "GET" && url.pathname === "/api/content") {
    const kind = url.searchParams.get("kind");
    const ref = url.searchParams.get("ref");
    if (!ref) {
      throw new CliError("Missing skill ref.");
    }
    const content = kind === "archived"
      ? await readArchivedSkillMd(context.home, ref)
      : await readInstalledSkillMd(context.home, ref);
    writeOk(response, { content });
    return;
  }

  if (method === "POST" && url.pathname === "/api/archive") {
    const body = await readJsonBody<{ refs?: string[]; dryRun?: boolean }>(request);
    const refs = body.refs ?? [];
    const result = await archiveSkillRefs(context.home, refs, { dryRun: body.dryRun });
    writeJson(response, 200, {
      ok: result.failed.length === 0,
      data: body.dryRun
        ? { dryRun: true, wouldArchive: result.archived, failed: result.failed, changes: result.changes }
        : result,
      changes: result.changes,
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/restore") {
    const body = await readJsonBody<{ archiveIds?: string[]; dryRun?: boolean }>(request);
    const archiveIds = body.archiveIds ?? [];
    const result = await restoreArchiveIds(context.home, archiveIds, { dryRun: body.dryRun });
    writeJson(response, 200, {
      ok: result.failed.length === 0,
      data: body.dryRun
        ? { dryRun: true, wouldRestore: result.restored, failed: result.failed, changes: result.changes }
        : result,
      changes: result.changes,
    });
    return;
  }

  writeJson(response, 404, { ok: false, error: "API route not found." });
}

async function serveStatic(response: ServerResponse, assetDir: string, requestPath: string): Promise<void> {
  const relativePath = requestPath === "/" ? "index.html" : decodeURIComponent(requestPath.slice(1));
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    writeJson(response, 403, { ok: false, error: "Forbidden" });
    return;
  }

  const filePath = path.join(assetDir, normalized);
  const stat = await fs.stat(filePath).catch(() => undefined);
  if (!stat?.isFile()) {
    const fallback = path.join(assetDir, "index.html");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(await fs.readFile(fallback));
    return;
  }

  response.writeHead(200, { "content-type": contentType(filePath) });
  response.end(await fs.readFile(filePath));
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  return request.headers[TOKEN_HEADER] === token;
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

function writeOk(response: ServerResponse, data: unknown): void {
  writeJson(response, 200, { ok: true, data });
}

function writeJson(response: ServerResponse, status: number, envelope: JsonEnvelope): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(jsonEnvelope(envelope));
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath);
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  return "text/html; charset=utf-8";
}
