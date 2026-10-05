import { gitBuildLabel } from "./buildLabel";
import { spanChain } from "./logQuery";
import { LOG_EVENTS, type EventsAt, type LogEventName, type LogFields, type LogLevel } from "./logEvents";

/**
 * Structured logs: one JSON object per line, `{ts, level, event, traceId, build, spanId?, parentId?, …fields}`,
 * with the fields of each event fixed by its zod schema in logEvents.ts (knowledge/logging.md has the
 * ids and jq recipes). The same module runs in the browser and in the tsx build scripts.
 *
 * - traceId: this page load (kept on every saved violation as its `session`) or this script run.
 * - build: the code that wrote it (buildLabel.ts: commit, uncommitted-change hash, version).
 * - spanId / parentId: a unit of work that spans frames or async steps (a violation and the post,
 *   shot, notice, clip and pursuit it leads to; a warp; a roadside stop), so one grep follows it.
 */

export type { LogEventName, LogFields, LogLevel } from "./logEvents";
export { spanChain } from "./logQuery";

/** A unit of work: its id, and the span that caused it. Kept on the object doing the work. */
export type Span = { readonly spanId: string; readonly parentId?: string };

export type LogEntry = {
  ts: string;
  level: LogLevel;
  event: string;
  traceId: string;
  build: string;
  spanId?: string;
  parentId?: string;
  [field: string]: unknown;
};

export const traceId: string =
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

// ---------- the build ----------

/** Set by vite.config.ts `define` (dev server, builds, vitest); absent under tsx. */
declare const __BUILD__: string | undefined;

/**
 * Under tsx there is no define: ask git through Node's builtins, reached at run time so the browser
 * bundle never imports them (process.getBuiltinModule, Node ≥ 22.3).
 */
function nodeBuildLabel(): string {
  try {
    const get = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process
      ?.getBuiltinModule;
    if (!get) return "unknown";
    const cp = get("node:child_process") as typeof import("node:child_process");
    const fs = get("node:fs") as typeof import("node:fs");
    const crypto = get("node:crypto") as typeof import("node:crypto");
    const root = new URL("..", import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(new URL("package.json", root), "utf8")) as { version?: string };
    const run = (command: string, args: readonly string[]) =>
      cp.execFileSync(command, args, {
        cwd: root,
        encoding: "utf8",
        // Read-only: git status must not take the index lock other processes may hold.
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      });
    const hash = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
    return gitBuildLabel(run, hash, pkg.version ?? "0");
  } catch {
    return "unknown";
  }
}

let build: string = typeof __BUILD__ === "string" ? __BUILD__ : nodeBuildLabel();

export function buildLabel(): string {
  return build;
}

/** The dev page asks the dev server for the tree as it is now (edits since the server started). */
export function setBuild(label: string): void {
  build = label;
}

// ---------- spans ----------

let spanCount = 0;

/** A new span `<kind>-<n>` (numbered within this trace), caused by `parent` if given. */
export function newSpan(kind: string, parent?: Span | null): Span {
  spanCount++;
  return parent
    ? { spanId: `${kind}-${spanCount}`, parentId: parent.spanId }
    : { spanId: `${kind}-${spanCount}` };
}

/** The span named by something that already has an id (`vio-<record id>`, `post-<post id>`). */
export function spanOf(kind: string, key: string | number, parent?: Span | null): Span {
  return parent ? { spanId: `${kind}-${key}`, parentId: parent.spanId } : { spanId: `${kind}-${key}` };
}

// ---------- the recent lines, for investigating in the dev build (window.__game.debug.logs) ----------

export type LogFilter = {
  /** An event name, a list of them, or a pattern (`/^pursuit_/`). */
  event?: string | readonly string[] | RegExp;
  level?: LogLevel;
  traceId?: string;
  /** Events of this span (not its children: `chain` follows those). */
  spanId?: string;
  /** Lines at or after this time (ISO string or epoch ms). */
  since?: string | number;
  /** At most this many, the latest. */
  limit?: number;
};

/**
 * A ring of the last `capacity` entries (the objects that were written, not re-parsed lines).
 * Why a ring and not an array spliced from the front: a push is one slot write, so it costs the
 * same in a per-frame path as in a rare one, and memory stays bounded for a session of hours.
 */
export class LogRing {
  private readonly slots: Array<LogEntry | undefined>;
  private next = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.slots = Array.from({ length: capacity }, () => undefined);
  }

  get size(): number {
    return this.count;
  }

  push(entry: LogEntry): void {
    this.slots[this.next] = entry;
    this.next = (this.next + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  clear(): void {
    this.slots.fill(undefined);
    this.next = 0;
    this.count = 0;
  }

  /** Everything kept, oldest first. */
  all(): LogEntry[] {
    const out: LogEntry[] = [];
    const first = (this.next - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      const e = this.slots[(first + i) % this.capacity];
      if (e) out.push(e);
    }
    return out;
  }

  query(filter: LogFilter = {}): LogEntry[] {
    const since = typeof filter.since === "string" ? Date.parse(filter.since) : filter.since;
    const matchesEvent = eventMatcher(filter.event);
    const hits = this.all().filter((e) => {
      if (!matchesEvent(e.event)) return false;
      if (filter.level && e.level !== filter.level) return false;
      if (filter.traceId && e.traceId !== filter.traceId) return false;
      if (filter.spanId && e.spanId !== filter.spanId) return false;
      if (since !== undefined && Date.parse(e.ts) < since) return false;
      return true;
    });
    return filter.limit === undefined ? hits : hits.slice(-filter.limit);
  }

  /**
   * The span and every span it led to (children by parentId, theirs, …), oldest first: a violation
   * with its post, the post's shot, the pursuit, the stop, the story.
   */
  chain(spanId: string): LogEntry[] {
    return spanChain(this.all(), spanId);
  }

  /** JSON lines (the console's format), for pasting into a file and jq. */
  jsonl(entries: readonly LogEntry[] = this.all()): string {
    return entries.map((e) => JSON.stringify(e)).join("\n");
  }
}

function eventMatcher(event: LogFilter["event"]): (name: string) => boolean {
  if (event === undefined) return () => true;
  if (typeof event === "string") return (name) => name === event;
  if (event instanceof RegExp) return (name) => event.test(name);
  const names = new Set(event);
  return (name) => names.has(name);
}

/** The last lines of this page / run. 2,000 lines of ~200 bytes: ~0.4 MB at most. */
export const recentLogs = new LogRing(2000);

// ---------- writing ----------

export type LogSink = (level: LogLevel, line: string, entry: LogEntry) => void;

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
// Optional chaining: outside Vite (a tsx script) there is no import.meta.env.
const env = import.meta.env as ImportMetaEnv | undefined;
const isProduction = env?.PROD === true;
const isVitest = typeof process !== "undefined" && process.env?.VITEST !== undefined;

/** The browser console by level (DevTools filters by it); Node: one stream, so `| jq` sees every line. */
const consoleSink: LogSink = (level, line) => {
  if (!isBrowser) return console.log(line);
  if (level === "error") return console.error(line);
  if (level === "warn") return console.warn(line);
  console.info(line);
};
// Under vitest the lines stay in recentLogs only (tests read them there): a test run that books
// violations would otherwise print hundreds of lines around the results. LOG_STDOUT=1 prints them.
const isQuietTest = isVitest && process.env.LOG_STDOUT === undefined;
let sink: LogSink = isQuietTest ? () => {} : consoleSink;

type Tap = (line: string, entry: LogEntry) => void;
const taps = new Set<Tap>();

/**
 * Every line as written, besides the sink (the dev page ships them to the dev server; diagnostics
 * watches for failures). Returns the unsubscribe. A tap that throws is dropped, not the line.
 */
export function onLogLine(tap: Tap): () => void {
  taps.add(tap);
  return () => taps.delete(tap);
}

function emit(level: LogLevel, entry: LogEntry): void {
  recentLogs.push(entry);
  const line = JSON.stringify(entry);
  sink(level, line, entry);
  for (const tap of taps) {
    try {
      tap(line, entry);
    } catch {
      taps.delete(tap);
    }
  }
}

/** Where the lines go (tests capture them; `null` puts back the console). */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? consoleSink;
}

/**
 * How much of the schema check runs. Dev builds, tests and the scripts check every line (a
 * safeParse of a few fields: microseconds). Production checks the first line of each event name in
 * the session: that catches a call site whose shape drifted on any path that runs at all, and costs
 * ~120 parses per session (one per event name), none of them per frame.
 * Why not off in production: a wrong shape there is exactly what a player's report would show us
 * with no way to rerun it. Why not sampled at random: one check per name already sees every shape a
 * call site can produce for most events (one object literal each), with no randomness in what we see.
 */
export type ValidationMode = "all" | "first" | "off";
let validation: ValidationMode = isProduction ? "first" : "all";
const checked = new Set<string>();

export function setLogValidation(mode: ValidationMode): void {
  validation = mode;
  checked.clear();
}

function write(level: LogLevel, event: string, fields: object | undefined, span: Span | undefined): void {
  const ts = new Date().toISOString();
  const entry: LogEntry = { ts, level, event, traceId, build };
  if (span) {
    entry.spanId = span.spanId;
    if (span.parentId !== undefined) entry.parentId = span.parentId;
  }
  Object.assign(entry, fields);
  // A field named like a line key (an untyped caller's `event`, `level`) must not rewrite the
  // line: the keys keep their place (first) and their value. The schema check reports the field.
  entry.ts = ts;
  entry.level = level;
  entry.event = event;
  entry.traceId = traceId;
  entry.build = build;
  emit(level, entry);
  const isChecked = validation === "all" || (validation === "first" && !checked.has(event));
  if (!isChecked) return;
  checked.add(event);
  const issues = problemsOf(level, event, fields);
  if (issues.length === 0) return;
  // Not through write(): an invalid report must not be checked (and reported) again.
  const report: LogEntry = {
    ts: entry.ts,
    level: "warn",
    event: "log_schema_invalid",
    traceId,
    build,
    invalidEvent: event,
    issues,
  };
  if (entry.spanId !== undefined) report.spanId = entry.spanId;
  if (entry.parentId !== undefined) report.parentId = entry.parentId;
  emit("warn", report);
}

type Issue = { path: string; message: string };

/** What is wrong with a line's fields, by its schema; never throws (a logger must not break the game). */
function problemsOf(level: LogLevel, event: string, fields: object | undefined): Issue[] {
  try {
    const def = (LOG_EVENTS as Record<string, (typeof LOG_EVENTS)[LogEventName] | undefined>)[event];
    if (!def) return [{ path: "event", message: `unknown event "${event}" (not in logEvents.ts)` }];
    const issues: Issue[] = [];
    if (def.level !== level)
      issues.push({ path: "level", message: `"${event}" is a ${def.level} event, logged as ${level}` });
    const result = def.fields.safeParse(fields ?? {});
    if (!result.success)
      for (const i of result.error.issues) {
        // An unknown field is reported at its parent: name it, so `.issues[].path` finds it.
        const path = i.code === "unrecognized_keys" ? [...i.path, i.keys.join(",")] : i.path;
        issues.push({ path: path.map(String).join("."), message: i.message });
      }
    return issues;
  } catch (e) {
    return [{ path: "", message: `schema check failed: ${String(e)}` }];
  }
}

/** An info event; `fields` must be that event's (logEvents.ts), `span` the work it belongs to. */
export function log<E extends EventsAt<"info">>(event: E, fields: LogFields<E>, span?: Span): void {
  write("info", event, fields, span);
}

/** A warn event (something failed or looks wrong, and the game goes on). */
export function warn<E extends EventsAt<"warn">>(event: E, fields: LogFields<E>, span?: Span): void {
  write("warn", event, fields, span);
}

/** An error event (the game or the script cannot go on). */
export function error<E extends EventsAt<"error">>(event: E, fields: LogFields<E>, span?: Span): void {
  write("error", event, fields, span);
}
