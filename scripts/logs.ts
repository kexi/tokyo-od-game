import { existsSync, readdirSync, readFileSync, realpathSync, statSync, watchFile } from "node:fs";
import { join, relative } from "node:path";
import { spanChain } from "../src/logQuery.ts";

/**
 * The page's and the scripts' log files from the terminal, one short line per event, for an agent
 * fixing a problem (knowledge/logging.md「AI のデバッグループ」). The log recipes (`just show-logs`, `just show-errors`, …) call it:
 *
 *   tail [n] [--follow] [file]   the last n lines of the latest session (following new ones)
 *   errors [file]                warn / error lines; uncaught_error with where, spans, state, before
 *   trace <spanId> [file]        the span and every span it led to
 *   since <minutes>              every session's lines of the last minutes, in time order
 *   compare [a] [b]              warn / error counts of two sessions (default: the one before, latest)
 *   repro [file]                 the URL that loads the session the same way
 *   files [n]                    the session files, newest first, with their counts and build
 *
 * A file is a path or a traceId (its file under .qa/logs is found); none means the latest.
 */

export type Line = {
  ts: string;
  level: string;
  event: string;
  traceId?: string;
  build?: string;
  spanId?: string;
  parentId?: string;
  [field: string]: unknown;
};

const ROOT = join(import.meta.dirname, "..");
export const LOG_DIR = join(ROOT, ".qa", "logs");

/** The JSON lines of a file; a DevTools copy's "main.js:1 " before the object is skipped. */
export function readLines(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.split("\n")) {
    const at = raw.indexOf("{");
    if (at < 0) continue;
    try {
      const value = JSON.parse(raw.slice(at)) as Line;
      const isLine = typeof value.ts === "string" && typeof value.event === "string";
      if (isLine) out.push(value);
    } catch {
      // Not a log line (a wrapped console message, a partial write).
    }
  }
  return out;
}

const OWN_KEYS = new Set(["ts", "level", "event", "traceId", "build", "spanId", "parentId"]);
const FAILURE_DETAIL = new Set(["stack", "frames", "spans", "state", "recent"]);
const LEVEL_MARK: Record<string, string> = { info: "I", warn: "W", error: "E" };
const MAX_VALUE = 120;

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    const isBare = /^[^\s="]{1,80}$/.test(value);
    return isBare ? value : clip(JSON.stringify(value));
  }
  if (value === undefined) return "undefined";
  return clip(JSON.stringify(value));
}

const clip = (text: string) => (text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text);

/** Where an uncaught_error was thrown: the first frame, as TypeScript when the dev server mapped it. */
export function failureSite(e: Line): string | null {
  const frames = e.frames as
    | Array<{ file: string; line: number; column: number; original?: string }>
    | undefined;
  const first = frames?.[0];
  if (!first) return null;
  return first.original ?? `${first.file}:${first.line}:${first.column}`;
}

/** `04:18:00.123 W road_tile_failed span<parent key=14/1/2 error="…"`: one event, one line. */
export function compactLine(e: Line): string {
  const time = e.ts.length >= 23 ? e.ts.slice(11, 23) : e.ts;
  const span = e.spanId ? ` ${e.spanId}${e.parentId ? `<${e.parentId}` : ""}` : "";
  const parts = [`${time} ${LEVEL_MARK[e.level] ?? e.level} ${e.event}${span}`];
  const isFailure = e.event === "uncaught_error";
  for (const [key, value] of Object.entries(e)) {
    if (OWN_KEYS.has(key)) continue;
    if (isFailure && FAILURE_DETAIL.has(key)) continue;
    parts.push(`${key}=${formatValue(value)}`);
  }
  const site = isFailure ? failureSite(e) : null;
  if (site) parts.push(`at=${site}`);
  return parts.join(" ");
}

/** The context of an uncaught_error, indented under its line. */
export function describeFailure(e: Line): string[] {
  const out: string[] = [];
  const frames =
    (e.frames as Array<{ fn?: string; file: string; line: number; column: number; original?: string }>) ?? [];
  for (const f of frames.slice(0, 6))
    out.push(`    at ${f.fn ?? "?"} ${f.original ?? `${f.file}:${f.line}:${f.column}`}`);
  const spans = (e.spans as Array<{ spanId: string; parentId?: string; lastEvent: string }>) ?? [];
  if (spans.length > 0)
    out.push(
      `    spans ${spans.map((s) => `${s.spanId}${s.parentId ? `<${s.parentId}` : ""}(${s.lastEvent})`).join(" ")}`,
    );
  if (e.state) out.push(`    state ${clip(JSON.stringify(e.state))}`);
  const recent = (e.recent as Array<{ ts: string; event: string; spanId?: string }>) ?? [];
  if (recent.length > 0)
    out.push(
      `    before ${recent
        .slice(-8)
        .map((r) => (r.spanId ? `${r.event}@${r.spanId}` : r.event))
        .join(" ")}`,
    );
  return out;
}

export function sinceMinutes(lines: readonly Line[], minutes: number, now = Date.now()): Line[] {
  const from = now - minutes * 60_000;
  return lines.filter((l) => Date.parse(l.ts) >= from).toSorted((a, b) => a.ts.localeCompare(b.ts));
}

/** What a warn / error is counted as: its event, and an uncaught_error's message too. */
const problemKey = (l: Line) =>
  l.event === "uncaught_error" ? `uncaught_error: ${String(l.message)}` : l.event;

export type Comparison = { key: string; before: number; after: number };

/** Warn / error counts per kind in two sessions, the kinds that changed first. */
export function compareProblems(before: readonly Line[], after: readonly Line[]): Comparison[] {
  const count = (lines: readonly Line[]) => {
    const n = new Map<string, number>();
    for (const l of lines) if (l.level !== "info") n.set(problemKey(l), (n.get(problemKey(l)) ?? 0) + 1);
    return n;
  };
  const a = count(before);
  const b = count(after);
  return [...new Set([...a.keys(), ...b.keys()])]
    .map((key) => ({ key, before: a.get(key) ?? 0, after: b.get(key) ?? 0 }))
    .toSorted(
      (x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before) || x.key.localeCompare(y.key),
    );
}

export function formatComparison(rows: readonly Comparison[], aName: string, bName: string): string[] {
  const out = [`before=${aName}`, `after=${bName}`];
  for (const r of rows) {
    const verdict =
      r.after === 0
        ? "gone"
        : r.before === 0
          ? "new"
          : r.after < r.before
            ? "fewer"
            : r.after > r.before
              ? "more"
              : "same";
    out.push(`${verdict.padEnd(5)} ${String(r.before).padStart(4)} -> ${String(r.after).padEnd(4)} ${r.key}`);
  }
  const errors = (key: "before" | "after") =>
    rows.filter((r) => r.key.startsWith("uncaught_error")).reduce((n, r) => n + r[key], 0);
  out.push(`uncaught_error ${errors("before")} -> ${errors("after")}`);
  return out;
}

/** The URL that loads the session the same way (the drive's if it started one, else the page's). */
export function reproOf(lines: readonly Line[]): string | null {
  const drive = lines.findLast((l) => l.event === "drive_started");
  const session = lines.findLast((l) => l.event === "session_start");
  const url = (drive ?? session)?.reproUrl;
  return typeof url === "string" ? url : null;
}

// ---------- files ----------

/** Every session file under .qa/logs, newest first. */
export function sessionFiles(dir = LOG_DIR): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const day of readdirSync(dir)) {
    const path = join(dir, day);
    if (!statSync(path).isDirectory()) continue;
    for (const f of readdirSync(path)) if (f.endsWith(".jsonl")) files.push(join(path, f));
  }
  return files.toSorted((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

/** A path, a traceId, or nothing (the latest session). */
export function resolveFile(arg: string | undefined, dir = LOG_DIR): string {
  if (arg && existsSync(arg)) return arg;
  if (arg) {
    const hit = sessionFiles(dir).find((f) => f.endsWith(`${arg}.jsonl`));
    if (!hit) throw new Error(`no log file or session ${arg} under ${relative(ROOT, dir)}`);
    return hit;
  }
  const latest = join(dir, "latest.jsonl");
  if (existsSync(latest)) return realpathSync(latest);
  const newest = sessionFiles(dir)[0];
  if (!newest)
    throw new Error(`no logs yet under ${relative(ROOT, dir)} (run just serve-dev and open the game)`);
  return newest;
}

const load = (file: string) => readLines(readFileSync(file, "utf8"));
/**
 * Control characters (C0, DEL, C1) as visible escapes: the lines carry text from the page — a chat
 * message typed in the game, a Y post, a stack — and an ESC in one would otherwise drive the
 * terminal (move the cursor, recolour, rewrite the title, hide what follows). Applied to every
 * line printed, whichever field it came from.
 */
export function terminalSafe(text: string): string {
  let safe = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    safe += isControl ? `\\u${code.toString(16).padStart(4, "0")}` : ch;
  }
  return safe;
}

/** The tool's output (what it reads, not log lines of its own: hence not the logger). */
const out = (text: string) => process.stdout.write(`${terminalSafe(text)}\n`);

function print(lines: readonly Line[], withDetail = false): void {
  for (const l of lines) {
    out(compactLine(l));
    if (withDetail && l.event === "uncaught_error") for (const d of describeFailure(l)) out(d);
  }
}

function follow(start: string, n: number): void {
  let file = start;
  let shown = load(file).length;
  print(load(file).slice(-n));
  out(`-- following ${relative(ROOT, file)} (Ctrl-C to stop)`);
  watchFile(file, { interval: 500 }, () => {
    const lines = load(file);
    print(lines.slice(shown));
    shown = lines.length;
  });
  // A reload is a new session (a new file): follow that one.
  setInterval(() => {
    const next = resolveFile(undefined);
    if (next === file) return;
    out(`-- new session ${relative(ROOT, next)}`);
    file = next;
    shown = 0;
    watchFile(file, { interval: 500 }, () => {
      const lines = load(file);
      print(lines.slice(shown));
      shown = lines.length;
    });
  }, 1000);
}

function main(argv: string[]): void {
  const [command = "tail", ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const args = rest.filter((a) => !a.startsWith("--") && a !== "");
  if (command === "tail") {
    const n = Number(args[0] ?? 40) || 40;
    const file = resolveFile(args[1]);
    if (flags.has("--follow")) return follow(file, n);
    out(`-- ${relative(ROOT, file)}`);
    return print(load(file).slice(-n));
  }
  if (command === "errors") {
    const file = resolveFile(args[0]);
    const lines = load(file);
    const problems = lines.filter((l) => l.level !== "info");
    out(`-- ${relative(ROOT, file)}: ${problems.length} warn/error of ${lines.length} lines`);
    return print(problems, true);
  }
  if (command === "trace") {
    const span = args[0];
    if (!span) throw new Error("trace <spanId> [file]");
    const chain = spanChain(load(resolveFile(args[1])), span);
    if (chain.length === 0) out(`-- no lines of span ${span}`);
    return print(chain, true);
  }
  if (command === "since") {
    const minutes = Number(args[0] ?? 10) || 10;
    const from = Date.now() - minutes * 60_000;
    const files = sessionFiles().filter((f) => statSync(f).mtimeMs >= from);
    return print(sinceMinutes(files.flatMap(load), minutes), true);
  }
  if (command === "compare") {
    const files = sessionFiles();
    const after = args[1] ? resolveFile(args[1]) : args[0] ? resolveFile(undefined) : files[0];
    const before = args[1] ? resolveFile(args[0]) : args[0] ? resolveFile(args[0]) : files[1];
    if (!before || !after) throw new Error("compare needs two sessions (reload the page once)");
    for (const l of formatComparison(
      compareProblems(load(before), load(after)),
      relative(ROOT, before),
      relative(ROOT, after),
    ))
      out(l);
    return;
  }
  if (command === "repro") {
    const url = reproOf(load(resolveFile(args[0])));
    out(url ?? "-- no session_start / drive_started in that session");
    return;
  }
  if (command === "files") {
    const n = Number(args[0] ?? 10) || 10;
    for (const f of sessionFiles().slice(0, n)) {
      const lines = load(f);
      const warns = lines.filter((l) => l.level === "warn").length;
      const errors = lines.filter((l) => l.level === "error").length;
      const stamp = new Date(statSync(f).mtimeMs).toISOString().slice(0, 19);
      out(
        `${stamp} lines=${lines.length} warn=${warns} error=${errors} build=${lines[0]?.build ?? "?"} ${relative(ROOT, f)}`,
      );
    }
    return;
  }
  throw new Error(`unknown command ${command} (tail, errors, trace, since, compare, repro, files)`);
}

// Only when run as a script: the tests import the functions above.
const isEntry = !!process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename;
if (isEntry) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    // A usage message for the terminal, not a log line: this tool reads logs, it does not write them.
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
