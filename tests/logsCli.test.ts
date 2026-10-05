import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compactLine,
  compareProblems,
  describeFailure,
  formatComparison,
  readLines,
  reproOf,
  resolveFile,
  sessionFiles,
  sinceMinutes,
  type Line,
} from "../scripts/logs";
import { spanChain } from "../src/logQuery";

const at = (s: number) => new Date(Date.UTC(2026, 9, 5, 4, 0, s)).toISOString();
const base = { traceId: "t1", build: "d727db1@0.1.0" };

const failure: Line = {
  ts: at(9),
  level: "error",
  event: "uncaught_error",
  ...base,
  spanId: "stop-3",
  parentId: "pursuit-2",
  source: "window_error",
  message: "x is undefined",
  stack: "TypeError: x is undefined\n    at …",
  frames: [
    {
      fn: "update",
      file: "/tokyo-od-game/src/game/pursuitDirector.ts",
      line: 900,
      column: 3,
      original: "src/game/pursuitDirector.ts:950:5",
    },
  ],
  spans: [{ spanId: "stop-3", parentId: "pursuit-2", lastEvent: "stop_begin" }],
  state: { mode: "car", lat: 35.68 },
  recent: [{ ts: at(8), level: "info", event: "stop_begin", spanId: "stop-3" }],
  suppressed: 0,
};

describe("the terminal view of the logs (scripts/logs.ts)", () => {
  it("writes one event per line: time, level, event, span<parent, then key=value", () => {
    const line: Line = {
      ts: at(1),
      level: "warn",
      event: "road_tile_failed",
      ...base,
      key: "14/1/2",
      error: "TypeError: Failed to fetch",
    };
    expect(compactLine(line)).toBe(
      '04:00:01.000 W road_tile_failed key=14/1/2 error="TypeError: Failed to fetch"',
    );
    const staged: Line = {
      ts: at(2),
      level: "info",
      event: "pursuit_stage",
      ...base,
      spanId: "pursuit-2",
      parentId: "vio-1",
      stage: 2,
    };
    expect(compactLine(staged)).toBe("04:00:02.000 I pursuit_stage pursuit-2<vio-1 stage=2");
  });

  it("puts an uncaught_error's site on its line and the context under it", () => {
    expect(compactLine(failure)).toBe(
      '04:00:09.000 E uncaught_error stop-3<pursuit-2 source=window_error message="x is undefined" suppressed=0 at=src/game/pursuitDirector.ts:950:5',
    );
    expect(describeFailure(failure)).toEqual([
      "    at update src/game/pursuitDirector.ts:950:5",
      "    spans stop-3<pursuit-2(stop_begin)",
      '    state {"mode":"car","lat":35.68}',
      "    before stop_begin@stop-3",
    ]);
  });

  it("clips long values so a line stays short", () => {
    const long: Line = {
      ts: at(1),
      level: "info",
      event: "pavements_built",
      ...base,
      wards: Array.from({ length: 40 }, () => "千代田区"),
    };
    expect(compactLine(long).length).toBeLessThan(200);
    expect(compactLine(long)).toContain("…");
  });

  it("reads JSON lines, also from a DevTools copy with the source before each object", () => {
    const text = [
      `main.ts:12 ${JSON.stringify({ ts: at(1), level: "info", event: "game_started" })}`,
      "garbage",
      "",
    ].join("\n");
    expect(readLines(text).map((l) => l.event)).toEqual(["game_started"]);
  });

  it("keeps the lines of the last minutes in time order", () => {
    const lines: Line[] = [
      { ts: at(50), level: "info", event: "b" },
      { ts: at(0), level: "info", event: "old" },
      { ts: at(40), level: "info", event: "a" },
    ];
    expect(sinceMinutes(lines, 0.5, Date.parse(at(60))).map((l) => l.event)).toEqual(["a", "b"]);
  });

  it("follows a violation's span to the pursuit and the stop", () => {
    const lines: Line[] = [
      { ts: at(1), level: "info", event: "violation_booked", spanId: "vio-1" },
      { ts: at(2), level: "info", event: "warp_start", spanId: "warp-1" },
      { ts: at(3), level: "info", event: "pursuit_begin", spanId: "pursuit-2", parentId: "vio-1" },
      { ts: at(4), level: "info", event: "stop_begin", spanId: "stop-3", parentId: "pursuit-2" },
      failure,
    ];
    expect(spanChain(lines, "vio-1").map((l) => l.event)).toEqual([
      "violation_booked",
      "pursuit_begin",
      "stop_begin",
      "uncaught_error",
    ]);
  });

  it("compares two sessions' problems, so a fix shows as gone", () => {
    const before: Line[] = [failure, failure, { ts: at(1), level: "warn", event: "road_tile_failed" }];
    const after: Line[] = [
      { ts: at(1), level: "warn", event: "road_tile_failed" },
      { ts: at(2), level: "warn", event: "i18n_missing" },
    ];
    const rows = compareProblems(before, after);
    expect(rows).toEqual([
      { key: "uncaught_error: x is undefined", before: 2, after: 0 },
      { key: "i18n_missing", before: 0, after: 1 },
      { key: "road_tile_failed", before: 1, after: 1 },
    ]);
    const text = formatComparison(rows, "a.jsonl", "b.jsonl");
    expect(text).toContain("gone     2 -> 0    uncaught_error: x is undefined");
    expect(text.at(-1)).toBe("uncaught_error 2 -> 0");
  });

  it("finds the URL that loads the session again, the drive's over the page's", () => {
    const lines: Line[] = [
      { ts: at(0), level: "info", event: "session_start", reproUrl: "http://localhost/?seed=1" },
      { ts: at(5), level: "info", event: "drive_started", reproUrl: "http://localhost/?seed=1&time=day" },
    ];
    expect(reproOf(lines)).toBe("http://localhost/?seed=1&time=day");
    expect(reproOf(lines.slice(0, 1))).toBe("http://localhost/?seed=1");
  });
});

describe("finding the session files", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tod-cli-"));
    mkdirSync(join(dir, "2026-10-05"));
    writeFileSync(join(dir, "2026-10-05", "aaaaaaaa-1.jsonl"), "");
    writeFileSync(join(dir, "2026-10-05", "bbbbbbbb-2.jsonl"), "");
    utimesSync(join(dir, "2026-10-05", "aaaaaaaa-1.jsonl"), 1000, 1000);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("lists them newest first, and takes a traceId or the latest", () => {
    expect(sessionFiles(dir).map((f) => f.split("/").at(-1))).toEqual([
      "bbbbbbbb-2.jsonl",
      "aaaaaaaa-1.jsonl",
    ]);
    expect(resolveFile("aaaaaaaa-1", dir)).toBe(join(dir, "2026-10-05", "aaaaaaaa-1.jsonl"));
    expect(resolveFile(undefined, dir)).toBe(join(dir, "2026-10-05", "bbbbbbbb-2.jsonl"));
    symlinkSync(join("2026-10-05", "aaaaaaaa-1.jsonl"), join(dir, "latest.jsonl"));
    expect(resolveFile(undefined, dir).endsWith("aaaaaaaa-1.jsonl")).toBe(true);
    expect(() => resolveFile("nope", dir)).toThrow(/no log file/);
  });
});
