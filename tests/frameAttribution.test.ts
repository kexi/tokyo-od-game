import { describe, expect, it } from "vitest";
import {
  attribute,
  CANDIDATES,
  NAMED_WRAPPERS,
  longGaps,
  markerCheck,
  selfShare,
  type CallFrame,
  type CpuProfile,
} from "../scripts/qa/frame-attribution";

// A profile on its own clock (µs): navigation started at 1,000,000 µs, so page time t ms is
// 1,000,000 + 1000 t µs. Samples every 10 ms, each a stack leaf first.
const NAV_US = 1_000_000;
const frame = (functionName: string, url = "", lineNumber = 0): CallFrame => ({
  functionName,
  url,
  lineNumber,
});
const ROOT = frame("(root)");
const STEP = frame("step", "http://localhost/tokyo-od-game/src/main.ts", 2685);
const NEAREST = frame("nearestWhere", "http://localhost/tokyo-od-game/src/world/roads.ts?t=1", 486);
const GC = frame("(garbage collector)");
const MARKER = frame("__qaMarker", "");
const THREE_BUILD = frame("build", "http://localhost/node_modules/.vite/deps/three.js", 10);

/** A profile from stacks (root last), one sample each `everyMs` from page time `fromMs`. */
function profileOf(stacks: CallFrame[][], fromMs: number, everyMs = 10): CpuProfile {
  const nodes: CpuProfile["nodes"] = [{ id: 1, callFrame: ROOT, children: [] }];
  const samples: number[] = [];
  for (const stack of stacks) {
    // Each stack as its own chain under the root (the analysis does not merge them).
    let parent = nodes[0];
    for (const f of stack.toReversed()) {
      const node = { id: nodes.length + 1, callFrame: f, children: [] as number[] };
      parent.children?.push(node.id);
      nodes.push(node);
      parent = node;
    }
    samples.push(parent.id);
  }
  const startTime = NAV_US + fromMs * 1000;
  return {
    nodes,
    startTime,
    endTime: startTime + stacks.length * everyMs * 1000,
    samples,
    timeDeltas: stacks.map(() => everyMs * 1000),
  };
}

describe("measure-frame-attribution's analysis (scripts/qa/frame-attribution.ts)", () => {
  it("takes only the rAF gaps over the threshold as long frames", () => {
    const gaps = longGaps([0, 16, 32, 132, 148, 199], 50);
    expect(gaps).toEqual([
      { start: 32, end: 132, ms: 100 },
      { start: 148, end: 199, ms: 51 },
    ]);
  });

  it("counts a sample in the gap holding the interval since the sample before it, on the mapped clock", () => {
    // Samples end at page 10, 20, …, 100 ms; the gap [40, 80] holds the intervals ending at 50…80.
    const stacks = Array.from({ length: 10 }, (_, i) => (i >= 4 && i < 8 ? [NEAREST, STEP] : [STEP]));
    const r = attribute(profileOf(stacks, 0), [{ start: 40, end: 80, ms: 40 }], NAV_US);
    expect(r.perGap[0].observedMs).toBe(40);
    expect(r.candidates.find((c) => c.id === "roadNearest")).toMatchObject({
      ms: 40,
      maxInFrameMs: 40,
      framesOver8: 1,
    });
  });

  it("counts a candidate when any frame of the stack matches, not only the leaf", () => {
    const stacks = [
      [GC, NEAREST, STEP],
      [THREE_BUILD, STEP],
    ];
    const r = attribute(profileOf(stacks, 0), [{ start: 0, end: 20, ms: 20 }], NAV_US);
    const by = Object.fromEntries(r.candidates.map((c) => [c.id, c.ms]));
    expect(by).toMatchObject({ roadNearest: 10, gc: 10, nodeBuild: 10 });
  });

  it("names the game's file nearest the leaf, and library code as library or native", () => {
    const stacks = [[GC, NEAREST, STEP], [THREE_BUILD, STEP], [frame("(program)")]];
    const r = attribute(profileOf(stacks, 0), [{ start: 0, end: 30, ms: 30 }], NAV_US);
    expect(r.files).toEqual([
      { name: "world/roads.ts", ms: 10 },
      { name: "main.ts", ms: 10 },
      { name: "(library or native)", ms: 10 },
    ]);
  });

  it("counts in how many long frames a candidate took 8 ms or more", () => {
    const stacks = Array.from({ length: 6 }, (_, i) => (i < 1 || i === 4 ? [NEAREST, STEP] : [STEP]));
    const gaps = [
      { start: 0, end: 20, ms: 20 },
      { start: 30, end: 60, ms: 30 },
    ];
    const r = attribute(profileOf(stacks, 0), gaps, NAV_US);
    expect(r.candidates.find((c) => c.id === "roadNearest")).toMatchObject({
      ms: 20,
      maxInFrameMs: 10,
      framesOver8: 2,
    });
  });

  it("gives a function's self time as a share of all the sampled time", () => {
    const human = frame("animateHuman", "http://localhost/tokyo-od-game/src/world/human.ts", 153);
    const stacks = [[human, STEP], [STEP], [STEP], [STEP]];
    const share = selfShare(profileOf(stacks, 0), (f) => f.functionName === "animateHuman");
    expect(share).toEqual({ ms: 10, sampledMs: 40, share: 0.25 });
  });

  it("holds the clock mapping only when the marker's samples fall in its mapped window", () => {
    const stacks = [[STEP], [MARKER], [MARKER], [MARKER], [STEP]];
    const profile = profileOf(stacks, 0);
    // The marker ran from page 10 ms for 30 ms: its samples end at 20, 30 and 40 ms.
    expect(markerCheck(profile, NAV_US + 10_000, 30).isMapped).toBe(true);
    expect(markerCheck(profile, NAV_US + 200_000, 30).isMapped).toBe(false);
  });

  it("splits a sample that straddles a frame's edge by the part inside it", () => {
    // Samples of 10 ms end at page 10, 20, 30; the gap [15, 25] holds half of the 2nd and of the 3rd.
    const stacks = [[STEP], [NEAREST, STEP], [NEAREST, STEP]];
    const r = attribute(profileOf(stacks, 0), [{ start: 15, end: 25, ms: 10 }], NAV_US);
    expect(r.perGap[0].observedMs).toBe(10);
    expect(r.candidates.find((c) => c.id === "roadNearest")?.ms).toBe(10);
    const one = attribute(profileOf(stacks, 0), [{ start: 5, end: 15, ms: 10 }], NAV_US);
    expect(one.candidates.find((c) => c.id === "roadNearest")?.ms).toBe(5);
  });

  it("takes a gap of exactly the threshold as not long", () => {
    expect(longGaps([0, 50, 100.1], 50)).toEqual([{ start: 50, end: 100.1, ms: expect.closeTo(50.1, 5) }]);
  });

  it("counts a frame where a candidate took exactly 8 ms", () => {
    const stacks = [[NEAREST, STEP], [STEP]];
    const r = attribute(profileOf(stacks, 0, 8), [{ start: 0, end: 16, ms: 16 }], NAV_US);
    expect(r.candidates.find((c) => c.id === "roadNearest")).toMatchObject({ ms: 8, framesOver8: 1 });
  });

  it("does not take a library's own src/ folder for the game's", () => {
    const lib = frame("inner", "http://localhost/tokyo-od-game/node_modules/.vite/deps/x/src/a.js");
    const r = attribute(profileOf([[lib]], 0), [{ start: 0, end: 10, ms: 10 }], NAV_US);
    expect(r.files).toEqual([{ name: "(library or native)", ms: 10 }]);
  });

  it("does not hold the clock mapping when only two thirds of the marker are in its window", () => {
    const stacks = [[STEP], [MARKER], [MARKER], [MARKER], [STEP]];
    // Mapped from 20 ms: the marker's samples ending at 30 and 40 are inside (20 ms), the one at 20 is not.
    expect(markerCheck(profileOf(stacks, 0), NAV_US + 20_000, 30)).toMatchObject({
      insideMs: 20,
      isMapped: false,
    });
  });

  it("hits the candidates on the URLs the dev server serves (three and the libraries pre-bundled under .vite/deps)", () => {
    const base = "http://localhost:5191/tokyo-od-game";
    const hit = (f: CallFrame) => CANDIDATES.filter((c) => c.match(f)).map((c) => c.id);
    expect(hit(frame("build", `${base}/node_modules/.vite/deps/three_webgpu.js?v=6568a4eb`, 1583))).toContain(
      "nodeBuild",
    );
    expect(
      hit(frame("updateMatrixWorld", `${base}/node_modules/.vite/deps/three.core-B-yWLuEf.js?v=1`, 10057)),
    ).toContain("matrixWorld");
    expect(hit(frame("nearestWhere", `${base}/src/world/roads.ts?t=1795`, 353))).toContain("roadNearest");
    expect(hit(frame("readFields", `${base}/node_modules/.vite/deps/pbf.js?v=1`, 10))).toContain(
      "vectorTiles",
    );
    expect(hit(frame("", `${base}/src/world/roadNetworkBuilder.ts`, 68))).toContain("roadReply");
    expect(hit(frame("restoreRoadNetwork", `${base}/src/world/roadNetworkData.ts`, 120))).toContain(
      "roadReply",
    );
    // The tables: by the page's named wrapper, not by the library's (minified) classes.
    expect(hit(frame("__qaParseTile", "", 0))).toEqual(["tileParseSync"]);
    expect(
      hit(frame("Q$1", `${base}/node_modules/.vite/deps/renderer-CUfHAmYW-DGeGN-4p.js?v=1`, 921)),
    ).toEqual([]);
  });

  it("makes in the page every function name a candidate matches by, under that same name", () => {
    // The page's wrappers are a string: renamed there alone, their candidate would count 0.
    const made = [
      { name: "__qaParseTile", candidate: "tileParseSync" },
      { name: "__qaLoadModel", candidate: "buildingLoadModel" },
    ];
    for (const { name, candidate } of made) {
      expect(NAMED_WRAPPERS).toContain(`const ${name} = `);
      const hits = CANDIDATES.filter((c) => c.match(frame(name, "", 0))).map((c) => c.id);
      expect(hits).toEqual([candidate]);
    }
    expect(NAMED_WRAPPERS).toContain("function __qaMarker(");
  });
});
