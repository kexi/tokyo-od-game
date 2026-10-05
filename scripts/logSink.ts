import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Plugin } from "vite";
import { gitBuildLabel } from "../src/buildLabel.ts";
import { LogBaseSchema } from "../src/logEvents.ts";
import { originalPosition, type SourceMapLike } from "./sourceMap.ts";

/**
 * The dev / preview server's end of the page's log shipping (src/diagnostics.ts LogShipper):
 * POST <base>__log with JSON lines appends them to .qa/logs/<date>/<traceId>.jsonl, and
 * .qa/logs/latest.jsonl points at the session that started last. GET <base>__log/build answers the
 * build label of the tree as it is now. `just logs*` (scripts/logs.ts) reads the files.
 *
 * Only from this machine, only lines shaped like the logger's: the server writes files on request,
 * so a request from elsewhere (another device on the network, a page on another origin, a DNS
 * rebinding host name) is refused, and a line that is not a log line is not written. The file name
 * is the line's traceId, checked to be an id. Nothing of this is in the production bundle: the page
 * only posts when served from localhost, and a deployed site has no such endpoint.
 */

export const SINK_LIMITS = {
  /** One batch (the page sends ≤ 256 KB). */
  bodyBytes: 512 * 1024,
  lines: 1000,
  lineBytes: 64 * 1024,
  /** One session's file: past this the lines are dropped (a loop logging every frame for hours). */
  fileBytes: 32 * 1024 * 1024,
};
export type SinkLimits = typeof SINK_LIMITS;

const TRACE_ID = /^[A-Za-z0-9-]{8,64}$/;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The build label (src/buildLabel.ts) of the tree at `root`, from git. */
export function readBuildLabel(root: string): string {
  const run = (command: string, args: readonly string[]) =>
    execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      // Read-only: git status must not take the index lock another process may hold.
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string })
    .version;
  return gitBuildLabel(run, (text) => createHash("sha256").update(text).digest("hex"), version ?? "0");
}

// ---------- the request ----------

export type SinkRequest = {
  method?: string;
  headers: IncomingMessage["headers"];
  remoteAddress?: string;
};
export type Verdict = { ok: true } | { ok: false; status: number; why: string };

const refuse = (status: number, why: string): Verdict => ({ ok: false, status, why });

/** Whether this request may write (`post`) or read the build label (`get`). */
export function checkSinkRequest(req: SinkRequest, kind: "post" | "get", limits = SINK_LIMITS): Verdict {
  const isLoopback = req.remoteAddress !== undefined && LOOPBACK.has(req.remoteAddress);
  if (!isLoopback) return refuse(403, "not from this machine");
  const host = req.headers.host ?? "";
  const hostname = host.replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(hostname)) return refuse(403, "host is not localhost");
  const origin = req.headers.origin;
  const isOtherOrigin = origin !== undefined && origin !== `http://${host}` && origin !== `https://${host}`;
  if (isOtherOrigin) return refuse(403, "cross-origin");
  const site = req.headers["sec-fetch-site"];
  const isOtherSite = site !== undefined && site !== "same-origin" && site !== "none";
  if (isOtherSite) return refuse(403, "cross-site");
  if (kind === "get") return req.method === "GET" ? { ok: true } : refuse(405, "GET only");
  if (req.method !== "POST") return refuse(405, "POST only");
  const type = String(req.headers["content-type"] ?? "");
  const isText = /^(text\/plain|application\/json|application\/x-ndjson)\b/.test(type);
  if (!isText) return refuse(415, "JSON lines as text/plain");
  const length = Number(req.headers["content-length"] ?? 0);
  if (length > limits.bodyBytes) return refuse(413, "batch too large");
  return { ok: true };
}

export type SinkEntry = {
  line: string;
  entry: Record<string, unknown> & { ts: string; traceId: string; event: string };
};

const Line = LogBaseSchema.loose();

/** The batch's log lines (JSON objects with the logger's keys and an id-shaped traceId); the rest counted. */
export function parseBatch(body: string, limits = SINK_LIMITS): { entries: SinkEntry[]; rejected: number } {
  const entries: SinkEntry[] = [];
  let rejected = 0;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const isOver = entries.length >= limits.lines || line.length > limits.lineBytes;
    if (isOver) {
      rejected++;
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      rejected++;
      continue;
    }
    const parsed = Line.safeParse(value);
    const isLogLine = parsed.success && TRACE_ID.test(parsed.data.traceId);
    if (!isLogLine) {
      rejected++;
      continue;
    }
    entries.push({ line, entry: value as SinkEntry["entry"] });
  }
  return { entries, rejected };
}

// ---------- the files ----------

/** YYYY-MM-DD of `ts` in the server's time zone (the day the developer sees). */
const two = (n: number) => String(n).padStart(2, "0");

function dayOf(ts: string): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** .qa/logs/<day>/<traceId>.jsonl, appended to; latest.jsonl → the session that started last. */
export class LogFiles {
  private readonly sizes = new Map<string, number>();
  private readonly files = new Map<string, string>();

  constructor(
    readonly dir: string,
    private readonly limits = SINK_LIMITS,
  ) {}

  get latest(): string {
    return join(this.dir, "latest.jsonl");
  }

  write(entries: readonly SinkEntry[]): { written: number; dropped: number } {
    let written = 0;
    let dropped = 0;
    const byFile = new Map<string, string[]>();
    for (const { line, entry } of entries) {
      const file = this.fileOf(entry.traceId, entry.ts);
      const size = this.sizes.get(file) ?? 0;
      if (size + line.length + 1 > this.limits.fileBytes) {
        dropped++;
        continue;
      }
      this.sizes.set(file, size + line.length + 1);
      const lines = byFile.get(file) ?? [];
      lines.push(line);
      byFile.set(file, lines);
      written++;
    }
    for (const [file, lines] of byFile) appendFileSync(file, `${lines.join("\n")}\n`);
    return { written, dropped };
  }

  /** The session's file (made, and made the latest, the first time the session is seen). */
  private fileOf(traceId: string, ts: string): string {
    const known = this.files.get(traceId);
    if (known) return known;
    const file = join(this.dir, dayOf(ts), `${traceId}.jsonl`);
    mkdirSync(dirname(file), { recursive: true });
    this.files.set(traceId, file);
    this.sizes.set(file, existsSync(file) ? statSync(file).size : 0);
    if (!existsSync(file)) appendFileSync(file, "");
    this.point(file);
    return file;
  }

  private point(file: string): void {
    try {
      if (existsSync(this.latest) || isLink(this.latest)) unlinkSync(this.latest);
      symlinkSync(relative(this.dir, file), this.latest);
    } catch {
      // No symlinks here (some file systems): a copy, refreshed each time a new session starts.
      copyFileSync(file, this.latest);
    }
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// ---------- source-mapped frames (dev server) ----------

/** The served file's source map and the file it was made from (null: not a module of this server). */
export type FrameResolver = (file: string) => Promise<{ map: SourceMapLike; file: string } | null>;

/** Adds `original` (TypeScript path:line:column from the project root) to an uncaught_error's frames. */
export async function mapFrames(
  entry: Record<string, unknown>,
  resolveMap: FrameResolver,
  root: string,
): Promise<boolean> {
  const frames = entry.frames;
  if (entry.event !== "uncaught_error" || !Array.isArray(frames)) return false;
  let isChanged = false;
  for (const frame of frames as Array<{
    file?: unknown;
    line?: unknown;
    column?: unknown;
    original?: string;
  }>) {
    const isFrame =
      typeof frame.file === "string" && typeof frame.line === "number" && typeof frame.column === "number";
    if (!isFrame) continue;
    const found = await resolveMap(frame.file as string).catch(() => null);
    if (!found) continue;
    const at = originalPosition(found.map, (frame.line as number) - 1, (frame.column as number) - 1);
    if (!at) continue;
    const source = isAbsolute(at.source) ? at.source : resolve(dirname(found.file), at.source);
    frame.original = `${relative(root, source)}:${at.line + 1}:${at.column + 1}`;
    isChanged = true;
  }
  return isChanged;
}

// ---------- the middleware and the plugin ----------

type Next = () => void;

function send(res: ServerResponse, status: number, body = ""): void {
  res.statusCode = status;
  if (body) res.setHeader("Content-Type", "application/json");
  res.end(body);
}

export type SinkOptions = {
  root: string;
  /** Where the files go (default <root>/.qa/logs). */
  dir?: string;
  build: () => string;
  resolveMap?: FrameResolver;
  limits?: SinkLimits;
};

export function logSinkMiddleware(opts: SinkOptions) {
  const limits = opts.limits ?? SINK_LIMITS;
  const files = new LogFiles(opts.dir ?? join(opts.root, ".qa", "logs"), limits);
  return (req: IncomingMessage, res: ServerResponse, next: Next): void => {
    const path = (req.url ?? "").split("?")[0];
    const isBuild = path.endsWith("/__log/build");
    const isPost = path.endsWith("/__log");
    if (!isBuild && !isPost) return next();
    const verdict = checkSinkRequest(
      { method: req.method, headers: req.headers, remoteAddress: req.socket.remoteAddress },
      isBuild ? "get" : "post",
      limits,
    );
    if (!verdict.ok) return send(res, verdict.status, JSON.stringify({ error: verdict.why }));
    if (isBuild) return send(res, 200, JSON.stringify({ build: opts.build() }));
    const chunks: Buffer[] = [];
    let bytes = 0;
    let isTooLarge = false;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limits.bodyBytes) {
        isTooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (isTooLarge) return send(res, 413, JSON.stringify({ error: "batch too large" }));
      const { entries, rejected } = parseBatch(Buffer.concat(chunks).toString("utf8"), limits);
      const mapping = opts.resolveMap
        ? Promise.all(
            entries.map(async (e) => {
              const isMapped = await mapFrames(e.entry, opts.resolveMap as FrameResolver, opts.root);
              if (isMapped) e.line = JSON.stringify(e.entry);
            }),
          )
        : Promise.resolve([]);
      void mapping
        .then(() => {
          const { written, dropped } = files.write(entries);
          send(res, 200, JSON.stringify({ written, dropped, rejected }));
        })
        .catch((error: unknown) => send(res, 500, JSON.stringify({ error: String(error) })));
    });
  };
}

/** The build label recomputed at most every 2 s (git status and diff take ~100 ms). */
function cachedBuild(root: string, initial: string): () => string {
  let label = initial;
  let at = Date.now();
  return () => {
    if (Date.now() - at < 2000) return label;
    at = Date.now();
    label = readBuildLabel(root);
    return label;
  };
}

/**
 * `__BUILD__` for every build (the label of the tree at start: dev server, `vite build`, vitest) and
 * the sink on the dev and preview servers.
 */
export function logSink(root: string): Plugin {
  const label = readBuildLabel(root);
  const build = cachedBuild(root, label);
  return {
    name: "log-sink",
    config: () => ({ define: { __BUILD__: JSON.stringify(label) } }),
    configureServer(server) {
      const base = server.config.base;
      const resolveMap: FrameResolver = async (file) => {
        const url = file.startsWith(base) ? `/${file.slice(base.length)}` : file;
        const mod = await server.environments.client.moduleGraph.getModuleByUrl(url);
        const map = mod?.transformResult?.map as SourceMapLike | null | undefined;
        if (!mod?.file || !map || typeof map.mappings !== "string") return null;
        return { map, file: mod.file };
      };
      server.middlewares.use(logSinkMiddleware({ root, build, resolveMap }));
    },
    configurePreviewServer(server) {
      server.middlewares.use(logSinkMiddleware({ root, build }));
    },
  };
}
