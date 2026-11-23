import { describe, expect, it } from "vitest";
import {
  attribute,
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
});
