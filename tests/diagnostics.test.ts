import { beforeEach, describe, expect, it } from "vitest";
import { gitBuildLabel } from "../src/buildLabel";
import {
  captureFailure,
  isLocalPage,
  LogShipper,
  parseStack,
  reproUrl,
  seededRandom,
  seedFrom,
  setDiagnosticsState,
} from "../src/diagnostics";
import { buildLabel, log, newSpan, recentLogs, setBuild } from "../src/log";
import { entrySchema } from "../src/logEvents";

describe("seed-able randomness (diagnostics.ts)", () => {
  it("gives the same sequence for the same seed and another for another", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const c = seededRandom(43);
    const seq = (r: () => number) => Array.from({ length: 5 }, r);
    const first = seq(a);
    expect(seq(b)).toEqual(first);
    expect(seq(c)).not.toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("reads ?seed= as a uint32 and builds the URL that loads the same start", () => {
    expect(seedFrom(new URLSearchParams("seed=123"))).toBe(123);
    expect(seedFrom(new URLSearchParams("seed=-1"))).toBeNull();
    expect(seedFrom(new URLSearchParams("seed=99999999999"))).toBeNull();
    const url = new URL(
      reproUrl({ start: "35.68,139.76", time: "night" }, "http://localhost:5173/tokyo-od-game/?noprewarm"),
    );
    expect(url.searchParams.get("start")).toBe("35.68,139.76");
    expect(url.searchParams.get("time")).toBe("night");
    expect(url.searchParams.has("seed")).toBe(true);
    expect(url.searchParams.has("noprewarm")).toBe(true);
  });
});

describe("stack frames", () => {
  it("reads Chrome's and Firefox's stacks as paths without the query", () => {
    const chrome = [
      "TypeError: Cannot read properties of undefined (reading 'x')",
      "    at PursuitDirector.update (http://localhost:5173/tokyo-od-game/src/game/pursuitDirector.ts?t=1759650000:433:21)",
      "    at http://localhost:5173/tokyo-od-game/src/main.ts:4100:7",
    ].join("\n");
    expect(parseStack(chrome)).toEqual([
      {
        fn: "PursuitDirector.update",
        file: "/tokyo-od-game/src/game/pursuitDirector.ts",
        line: 433,
        column: 21,
      },
      { file: "/tokyo-od-game/src/main.ts", line: 4100, column: 7 },
    ]);
    const firefox =
      "update@http://localhost:5173/tokyo-od-game/src/main.ts:10:5\n@http://localhost:5173/x.js:1:1";
    expect(parseStack(firefox)).toEqual([
      { fn: "update", file: "/tokyo-od-game/src/main.ts", line: 10, column: 5 },
      { file: "/x.js", line: 1, column: 1 },
    ]);
  });
});

describe("a captured failure", () => {
  beforeEach(() => recentLogs.clear());

  it("is one uncaught_error line with the frames, the spans, the state and the lines before it", () => {
    const pursuit = newSpan("pursuit", { spanId: "vio-x" });
    log("pursuit_stage", { stage: 2 }, pursuit);
    log("game_started", {});
    setDiagnosticsState({
      mode: () => "car",
      lat: () => 35.68,
      lon: () => 139.76,
      // One reading failing (a variable not yet initialised) must not lose the others.
      backend: () => {
        throw new ReferenceError("renderInfo is not defined");
      },
      activeSpans: () => [pursuit.spanId, undefined],
    });
    captureFailure("window_error", new TypeError("x is undefined"), 1_000_000);
    const line = recentLogs.query({ event: "uncaught_error" })[0];
    expect(entrySchema("uncaught_error").safeParse(line).success).toBe(true);
    expect(line).toMatchObject({
      level: "error",
      source: "window_error",
      message: "x is undefined",
      spans: [{ spanId: pursuit.spanId, parentId: "vio-x", lastEvent: "pursuit_stage" }],
      state: { mode: "car", lat: 35.68, lon: 139.76, activeSpans: [pursuit.spanId] },
      recent: [
        expect.objectContaining({ event: "pursuit_stage", spanId: pursuit.spanId }),
        expect.objectContaining({ event: "game_started" }),
      ],
      suppressed: 0,
    });
    expect((line.frames as unknown[]).length).toBeGreaterThan(0);
  });

  it("counts the same failure within 5 s instead of logging it every frame", () => {
    for (let i = 0; i < 60; i++) captureFailure("unhandled_rejection", "boom", 2_000_000 + i * 16);
    captureFailure("unhandled_rejection", "boom", 2_000_000 + 6000);
    const lines = recentLogs.query({ event: "uncaught_error" });
    expect(lines.map((l) => l.suppressed)).toEqual([0, 59]);
    expect(lines[0].stack).toBeNull();
  });
});

describe("shipping lines to the dev server", () => {
  it("sends only from this machine", () => {
    expect(isLocalPage("localhost")).toBe(true);
    expect(isLocalPage("127.0.0.1")).toBe(true);
    expect(isLocalPage("example.github.io")).toBe(false);
    expect(isLocalPage("192.168.1.20")).toBe(false);
  });

  it("batches by lines and bytes, keeps a bounded queue and says what it dropped", async () => {
    const sent: string[][] = [];
    const shipper = new LogShipper(
      (body) => {
        sent.push(body.split("\n"));
        return true;
      },
      { queue: 5, batchLines: 3, batchBytes: 1000 },
    );
    for (let i = 0; i < 8; i++) shipper.push(`{"n":${i}}`);
    expect(shipper.pending).toBe(5);
    await shipper.flush();
    // The drop notice is a log line (on the page it reaches this queue through onLogLine).
    expect(sent[0]).toEqual(['{"n":3}', '{"n":4}', '{"n":5}']);
    expect(recentLogs.query({ event: "log_ship_dropped" }).at(-1)).toMatchObject({ lines: 3 });
    await shipper.flush(true);
    expect(sent.slice(1).flat()).toEqual(['{"n":6}', '{"n":7}']);
  });

  it("stops after a refused batch (a server without the sink)", async () => {
    let calls = 0;
    const shipper = new LogShipper(() => {
      calls++;
      return false;
    });
    shipper.push("{}");
    await shipper.flush();
    shipper.push("{}");
    await shipper.flush();
    expect(calls).toBe(1);
    expect(shipper.stopped).toBe(true);
    expect(shipper.pending).toBe(0);
  });
});

describe("the build identity in every line (buildLabel.ts)", () => {
  const git = (out: Record<string, string>) => (_cmd: string, args: readonly string[]) => {
    const value = out[args[0]];
    if (value === undefined) throw new Error("no git");
    return value;
  };
  const hash = (text: string) => (text.length.toString(16) + "000000").slice(0, 8);

  it("is the commit and version, with a hash of the changes when the tree is dirty", () => {
    expect(gitBuildLabel(git({ "rev-parse": "d727db1\n", status: "" }), hash, "0.1.0")).toBe("d727db1@0.1.0");
    const dirty = gitBuildLabel(
      git({ "rev-parse": "d727db1\n", status: " M src/log.ts\n", diff: "+x" }),
      hash,
      "0.1.0",
    );
    expect(dirty).toMatch(/^d727db1\+[0-9a-f]{6}@0\.1\.0$/);
    expect(gitBuildLabel(git({}), hash, "0.1.0")).toBe("nogit@0.1.0");
  });

  it("is on every line, and the dev page can update it", () => {
    log("game_started", {});
    expect(recentLogs.all().at(-1)?.build).toBe(buildLabel());
    const before = buildLabel();
    setBuild("abc1234+00ff00@0.1.0");
    log("game_started", {});
    expect(recentLogs.all().at(-1)?.build).toBe("abc1234+00ff00@0.1.0");
    setBuild(before);
  });
});
