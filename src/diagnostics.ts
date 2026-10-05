import { error as logError, log, onLogLine, recentLogs, setBuild, warn, type LogEntry } from "./log";

/**
 * What lets an agent in a terminal trace a problem without opening the browser console
 * (knowledge/logging.md「AI のデバッグループ」):
 * - every line goes to the dev / preview server, which appends it to .qa/logs/<date>/<traceId>.jsonl
 *   (LogShipper; only when the page is served from this machine, see isLocalPage);
 * - a failure nothing handled becomes one `uncaught_error` line with its stack, the spans around
 *   it, the game's state and the lines before it (captureFailure);
 * - the page load starts with `session_start` (the seed of Math.random, the URL to load it again).
 *
 * Nothing here runs at import: diagnosticsBoot.ts calls installDiagnostics() first thing on the
 * page, and the tests call the parts.
 */

// ---------- seed-able randomness ----------

/** mulberry32: a 32-bit seed, a period of 2^32, a few integer ops per call. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `?seed=` as a uint32, or null when absent or not a number. */
export function seedFrom(params: URLSearchParams): number | null {
  const raw = params.get("seed");
  if (raw === null || !/^\d{1,10}$/.test(raw)) return null;
  const seed = Number(raw);
  return seed <= 0xffffffff ? seed : null;
}

let sessionSeed = 0;

/** The page's URL with these parameters set (and the seed): loading it starts the same way. */
export function reproUrl(extra: Record<string, string> = {}, href = globalThis.location?.href ?? ""): string {
  const url = new URL(href || "http://localhost/");
  url.searchParams.set("seed", String(sessionSeed));
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return url.toString();
}

// ---------- failures ----------

export type Frame = { fn?: string; file: string; line: number; column: number; original?: string };

// Chrome / Node: "    at fn (url:12:34)" or "    at url:12:34"; Firefox / Safari: "fn@url:12:34".
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;
const GECKO_FRAME = /^(.*?)@(.+?):(\d+):(\d+)$/;

/**
 * The frames of a stack, file as the URL's path without the query (`/tokyo-od-game/src/main.ts`):
 * the dev server maps that path back to the TypeScript line, and grep finds it in the code.
 */
export function parseStack(stack: string, max = 15): Frame[] {
  const frames: Frame[] = [];
  for (const raw of stack.split("\n")) {
    const m = V8_FRAME.exec(raw) ?? GECKO_FRAME.exec(raw.trim());
    if (!m) continue;
    const [, fn, url, line, column] = m;
    const frame: Frame = { file: pathOf(url), line: Number(line), column: Number(column) };
    if (fn) frame.fn = fn;
    frames.push(frame);
    if (frames.length >= max) break;
  }
  return frames;
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.pathname : url;
  } catch {
    return url;
  }
}

/** The game's state at a failure, each read on its own (one in its TDZ must not lose the rest). */
export type StateReaders = {
  mode?: () => string;
  state?: () => string;
  lat?: () => number;
  lon?: () => number;
  gameTime?: () => string;
  timeMode?: () => string;
  weather?: () => string;
  graphicsPreset?: () => string;
  backend?: () => string;
  activeSpans?: () => Array<string | undefined>;
};

let readers: StateReaders | null = null;

/** main.ts hands over how to read its state (closures over its variables). */
export function setDiagnosticsState(next: StateReaders): void {
  readers = next;
}

function readState(): Record<string, unknown> | null {
  if (!readers) return null;
  const out: Record<string, unknown> = {};
  for (const [key, read] of Object.entries(readers)) {
    try {
      const value = (read as () => unknown)();
      if (key === "activeSpans")
        out[key] = (value as Array<string | undefined>).filter((s) => s !== undefined);
      else if (value !== undefined && value !== null) out[key] = value;
    } catch {
      // Not yet initialised (or gone): the other readings still count.
    }
  }
  return out;
}

export type FailureSource = "window_error" | "unhandled_rejection" | "device_lost" | "fatal";

const RECENT = 30;
const SPAN_LOOKBACK = 100;
const STACK_CHARS = 4000;
const REPEAT_MS = 5000;
const lastSeen = new Map<string, { at: number; suppressed: number }>();

/**
 * One `uncaught_error` line for a failure. The same message from the same source within 5 s is
 * counted, not logged (an error in the frame loop would otherwise write 60 lines a second).
 */
export function captureFailure(source: FailureSource, failure: unknown, now = Date.now()): void {
  const message = failure instanceof Error ? failure.message : String(failure);
  const key = `${source}\n${message}`;
  const seen = lastSeen.get(key);
  const isRepeat = seen !== undefined && now - seen.at < REPEAT_MS;
  if (isRepeat) {
    seen.suppressed++;
    return;
  }
  const suppressed = seen?.suppressed ?? 0;
  lastSeen.set(key, { at: now, suppressed: 0 });
  const stack = failure instanceof Error && failure.stack ? failure.stack.slice(0, STACK_CHARS) : null;
  const before = recentLogs.all();
  logError("uncaught_error", {
    source,
    message,
    stack,
    frames: stack ? parseStack(stack) : [],
    spans: spansOf(before.slice(-SPAN_LOOKBACK)),
    state: readState(),
    recent: before.slice(-RECENT).map((e) => {
      const r: { ts: string; level: string; event: string; spanId?: string } = {
        ts: e.ts,
        level: e.level,
        event: e.event,
      };
      if (e.spanId !== undefined) r.spanId = e.spanId;
      return r;
    }),
    suppressed,
  });
}

/** The spans of these lines, the most recent first (8 at most), with the event each logged last. */
function spansOf(
  entries: readonly LogEntry[],
): Array<{ spanId: string; parentId?: string; lastEvent: string }> {
  const out = new Map<string, { spanId: string; parentId?: string; lastEvent: string }>();
  for (let i = entries.length - 1; i >= 0 && out.size < 8; i--) {
    const e = entries[i];
    if (e.spanId === undefined || out.has(e.spanId)) continue;
    const s: { spanId: string; parentId?: string; lastEvent: string } = {
      spanId: e.spanId,
      lastEvent: e.event,
    };
    if (e.parentId !== undefined) s.parentId = e.parentId;
    out.set(e.spanId, s);
  }
  return [...out.values()];
}

/** An ErrorEvent's error, or what the event says when the error itself is not given (a script error). */
function errorOf(e: {
  error?: unknown;
  message?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}) {
  if (e.error instanceof Error) return e.error;
  const where = e.filename ? `\n    at ${e.filename}:${e.lineno ?? 0}:${e.colno ?? 0}` : "";
  const synthetic = new Error(e.message ?? String(e.error));
  synthetic.stack = `Error: ${synthetic.message}${where}`;
  return synthetic;
}

// ---------- shipping lines to the dev server ----------

export const LOG_ENDPOINT = "__log";

/** Served from this machine (the dev or preview server): never a deployed page. */
export function isLocalPage(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export type Post = (body: string, isUnloading: boolean) => Promise<boolean> | boolean;

export type ShipperLimits = { queue: number; batchLines: number; batchBytes: number };
export const SHIPPER_LIMITS: ShipperLimits = { queue: 2000, batchLines: 200, batchBytes: 256 * 1024 };

/**
 * Lines waiting for the dev server, sent in batches (every second, or at once when the page is
 * hidden). Bounded: past `queue` lines the oldest go and a `log_ship_dropped` line says how many.
 * The first refused or failed batch stops it (a server without the sink, e.g. another static
 * server): the page then keeps its lines in recentLogs only.
 */
export class LogShipper {
  private queue: string[] = [];
  private dropped = 0;
  private sending = false;
  stopped = false;

  constructor(
    private readonly post: Post,
    private readonly limits: ShipperLimits = SHIPPER_LIMITS,
  ) {}

  get pending(): number {
    return this.queue.length;
  }

  push(line: string): void {
    if (this.stopped) return;
    this.queue.push(line);
    if (this.queue.length <= this.limits.queue) return;
    this.queue.shift();
    this.dropped++;
  }

  /** One batch (or, unloading, everything as beacons of a batch each). */
  async flush(isUnloading = false): Promise<void> {
    if (this.stopped || this.sending) return;
    if (this.dropped > 0) {
      const lines = this.dropped;
      this.dropped = 0;
      // Through the logger: the line lands in the queue (and in recentLogs) like any other.
      warn("log_ship_dropped", { lines });
    }
    // Unloading: every batch now (the page is going); otherwise one per call (per second).
    for (;;) {
      const batch = this.take();
      if (batch.length === 0) return;
      this.sending = !isUnloading;
      let isSent = false;
      try {
        isSent = await this.post(batch.join("\n"), isUnloading);
      } catch {
        isSent = false;
      }
      this.sending = false;
      if (!isSent) {
        this.stopped = true;
        this.queue = [];
        return;
      }
      if (!isUnloading) return;
    }
  }

  private take(): string[] {
    let bytes = 0;
    let n = 0;
    while (n < this.queue.length && n < this.limits.batchLines) {
      bytes += this.queue[n].length + 1;
      if (bytes > this.limits.batchBytes && n > 0) break;
      n++;
    }
    return this.queue.splice(0, n);
  }
}

// ---------- installing it on the page ----------

let isInstalled = false;

export function installDiagnostics(): void {
  if (isInstalled || typeof window === "undefined") return;
  isInstalled = true;
  const params = new URLSearchParams(location.search);
  // Before any game module runs (this is the page's first script): one seed for the whole load.
  // Why every load and not only with ?seed=: a failure seen once can then be loaded again.
  const asked = seedFrom(params);
  sessionSeed = asked ?? crypto.getRandomValues(new Uint32Array(1))[0];
  Math.random = seededRandom(sessionSeed);
  const env = import.meta.env as ImportMetaEnv | undefined;
  log("session_start", {
    path: location.pathname,
    params: Object.fromEntries(params),
    seed: sessionSeed,
    seeded: asked !== null,
    reproUrl: reproUrl(),
    mode: env?.MODE ?? "unknown",
    language: navigator.language,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
  });
  window.addEventListener("error", (e) => captureFailure("window_error", errorOf(e)));
  window.addEventListener("unhandledrejection", (e) => captureFailure("unhandled_rejection", e.reason));
  // renderer.ts logs the loss (warn); the context comes with it here.
  onLogLine((_line, entry) => {
    if (entry.event !== "gpu_device_lost") return;
    captureFailure(
      "device_lost",
      new Error(`GPU device lost: ${String(entry.error)} (${String(entry.reason)})`),
    );
  });
  if (!isLocalPage(location.hostname)) return;
  shipToDevServer(`${env?.BASE_URL ?? "/"}${LOG_ENDPOINT}`);
}

function shipToDevServer(endpoint: string): void {
  const post: Post = async (body, isUnloading) => {
    if (isUnloading) return navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain" }));
    const res = await fetch(endpoint, { method: "POST", body, headers: { "content-type": "text/plain" } });
    return res.ok;
  };
  const shipper = new LogShipper(post);
  // What was written before this ran (the logger's own start) goes first.
  for (const e of recentLogs.all()) shipper.push(JSON.stringify(e));
  onLogLine((line) => shipper.push(line));
  setInterval(() => void shipper.flush(), 1000);
  addEventListener("pagehide", () => void shipper.flush(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void shipper.flush(true);
  });
  // The tree as it is now (the define is from when the server started; edits come after).
  void fetch(`${endpoint}/build`)
    .then((res) => (res.ok ? (res.json() as Promise<{ build?: unknown }>) : null))
    .then((b) => {
      if (typeof b?.build === "string") setBuild(b.build);
    })
    .catch(() => undefined);
}
