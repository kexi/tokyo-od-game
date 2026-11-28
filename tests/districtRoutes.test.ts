import { describe, expect, it } from "vitest";
import { districtsOfFiles, readExpresswayFiles } from "../scripts/expresswayFiles";
import { chunkAt, type DeckRoute } from "../scripts/qa/deckRoutes";
import { districtRoutes, PIECE_M } from "../scripts/qa/districtRoutes";
import { bundlesOf, OPEN_S, REOPEN_EVERY, routeWallSeconds } from "../scripts/qa/routeBundles";
import { routeCoverage } from "../scripts/qa/routeCoverage";
import type { XwChunk, XwEnd, XwRunSummary } from "../src/expressway/format";
import { STATION_STRIDE } from "../src/expressway/format";
import { endAhead, rangeOfChunks } from "../src/world/expresswayEnds";

// The district route generator (R1-5 PR B): on a small synthetic network every kind of route comes
// out once (B1: main lines in lane 0 chained entrance → main → exit, a ramp's other lane, a JCT
// connector, a dead end's wall in each lane, an autopilot pair) and a closed run gets none; the same
// data gives the same table (B3); on the data under test every place resolves to a chunk (B2); the
// bundles keep to their budget.

/** A straight run east along lat 35.6 from lon0, `len` m, in one chunk of `lanes` lanes. */
function run(
  id: string,
  cls: XwRunSummary["cls"],
  start: XwEnd,
  end: XwEnd,
  lon0: number,
  len: number,
  lanes = 2,
) {
  const kx = 111320 * Math.cos((35.6 * Math.PI) / 180);
  const st: number[] = [];
  for (let s = 0; s <= len; s += len / 4) st.push(s, lon0 + s / kx, 35.6, 10, 0, 5, 0);
  const chunk = {
    id: `${id}:0`,
    run: id,
    chain: id,
    k: 0,
    cls,
    lanes,
    laneWidth: 3.5,
    shoulderL: 1,
    shoulderR: 1,
    posted: 60,
    structure: "viaduct",
    st,
    prev: null,
    next: null,
  } as unknown as XwChunk;
  const summary = {
    id,
    chain: id,
    cls,
    lengthM: len,
    start,
    end,
    chunks: [chunk.id],
  } as unknown as XwRunSummary;
  return { summary, chunk };
}

const ground: XwEnd = { kind: "ground" };
const open: XwEnd = { kind: "open" };
const at = (parent: string, parentS: number, kind: XwEnd["kind"] = "junction"): XwEnd => ({
  kind,
  parent,
  parentS,
});

/**
 * A1 (1,000 m) seams into A2 (2,000 m), which comes down to the ground: one main line. B (800 m) is a line of its own whose end has
 * nothing beyond (a wall). E comes from the street and merges into A1 at 500; X leaves A2 at 300 for
 * the street, in 2 lanes; J leaves A1 at 800 and merges into B at 100; Z is closed (not written).
 */
function network() {
  const parts = [
    run("A1", "expressway", open, at("A2", 0, "seam"), 139.7, 1000),
    run("A2", "expressway", at("A1", 1000, "seam"), ground, 139.71, 2000),
    run("B", "expressway", open, open, 139.73, 800),
    run("E", "ramp", ground, at("A1", 500), 139.69, 300, 1),
    run("X", "ramp", at("A2", 300), ground, 139.711, 300, 2),
    run("J", "ramp", at("A1", 800), at("B", 100), 139.705, 400, 1),
  ];
  const closed = {
    id: "Z",
    chain: "Z",
    cls: "ramp",
    lengthM: 200,
    start: open,
    end: open,
    chunks: [],
  } as unknown as XwRunSummary;
  const runs = [...parts.map((p) => p.summary), closed];
  const byRun = new Map(parts.map((p) => [p.summary.id, [p.chunk]]));
  const entrances = [
    {
      run: "E",
      lon: 139.69,
      lat: 35.6,
      heading: 0,
      name: "E",
      nameEn: null,
      route: "1",
      routeName: null,
      routeNameEn: null,
    },
  ];
  const net = {
    runs,
    byRun,
    entrances,
    closed: [{ run: "Z", chain: "Z", cls: "ramp" as const, reason: "test" }],
  };
  const districts = new Map(runs.map((r) => [r.id, "central" as const]));
  return { net, districts };
}

describe("districtRoutes on a small network", () => {
  const { net, districts } = network();
  const table = districtRoutes(net, districts, "central");
  const ids = table.routes.map((r) => r.id);
  const route = (id: string) => table.routes.find((r) => r.id === id)!;

  it("makes each kind of route once, and nothing for the closed run", () => {
    expect(ids.toSorted()).toEqual(
      [
        "main-A1-1",
        "main-A1-2",
        "main-B-1",
        "ramp-X-lane1",
        "ramp-J-lane0",
        "wall-B-lane0-posted",
        "wall-B-lane1-posted",
        "auto-E-X",
      ].toSorted(),
    );
    expect(table.uncovered).toEqual([{ run: "Z", why: "closed" }]);
  });

  it("chains the main line: out by the exit X, then on again up the entrance E (C), the branch first in prefer", () => {
    const first = route("main-A1-1");
    expect(first).toMatchObject({
      kind: "cruise",
      lane: 0,
      from: { run: "A1" },
      to: { run: "X", street: true },
    });
    expect(first.kind === "cruise" && first.prefer).toEqual(["X", "A1", "A2"]);
    const second = route("main-A1-2");
    expect(second).toMatchObject({ from: { run: "E" }, to: { run: "A2" } });
    expect(second.kind === "cruise" && second.prefer).toEqual(["E", "A1", "A2"]);
  });

  it("drives a ramp's other lanes, and a connector from before its diverge to past its merge", () => {
    expect(route("ramp-X-lane1")).toMatchObject({
      lane: 1,
      from: { run: "A2" },
      to: { run: "X", street: true },
    });
    const j = route("ramp-J-lane0");
    expect(j).toMatchObject({ from: { run: "A1", s: 500 }, to: { run: "B", s: 400 } });
    expect(j.kind === "cruise" && j.prefer).toEqual(["J", "B", "A1"]);
  });

  it("puts a wall route in each lane of a dead end, and pairs the entrance with an exit", () => {
    expect(route("wall-B-lane1-posted")).toMatchObject({
      kind: "wall",
      wall: "B",
      lane: 1,
      from: { run: "B", s: 400 },
    });
    expect(route("auto-E-X")).toMatchObject({ kind: "auto", entrance: "E" });
    expect(table.streetPlaces.map((p) => p.id).toSorted()).toEqual(["foot-E-start", "foot-X-end"]);
  });

  it("drives every planned lane of the network, lists the closed run, and counts the main lanes left by decision (B3)", () => {
    const c = routeCoverage(net, districts, "central", table.routes, table.uncovered);
    expect(c.shareOfPlan).toBe(1);
    expect(c.lanesByDecision).toBe(3);
    expect(c.undriven).toEqual([{ run: "Z", why: "closed" }]);
    const without = routeCoverage(
      net,
      districts,
      "central",
      table.routes.filter((r) => r.id !== "ramp-J-lane0"),
      table.uncovered,
    );
    expect(without.undriven).toEqual([
      { run: "J", why: "no route (and no reason: a gap in the generator)" },
      { run: "Z", why: "closed" },
    ]);
  });

  it("gives the same table from the same data (B3)", () => {
    const again = districtRoutes(network().net, network().districts, "central");
    expect(JSON.stringify(again)).toBe(JSON.stringify(table));
  });
});

describe("bundles", () => {
  const r = (id: string, seconds: number): DeckRoute =>
    ({
      id,
      kind: "cruise",
      from: { run: "A", s: 0 },
      prefer: ["A"],
      to: { run: "A", s: 1 },
      kmh: 60,
      seconds,
      was: "",
    }) as DeckRoute;

  it("keeps each bundle within its budget, opening a page at its start and every REOPEN_EVERY routes", () => {
    const routes = Array.from({ length: 25 }, (_, i) => r(`r${i}`, 60 + 1.5 * 100));
    const bundles = bundlesOf(routes, 25 * 60);
    expect(bundles.flatMap((b) => b.ids)).toEqual(routes.map((x) => x.id));
    for (const b of bundles) expect(b.seconds).toBeLessThanOrEqual(25 * 60);
    const per = routeWallSeconds(routes[0]);
    const firstTen = OPEN_S + REOPEN_EVERY * per;
    expect(bundles[0].ids.length).toBeGreaterThanOrEqual(REOPEN_EVERY);
    expect(bundles[0].seconds).toBeGreaterThanOrEqual(Math.round(firstTen));
  });

  it("flags a route longer than the budget as a bundle of its own", () => {
    const bundles = bundlesOf([r("short", 120), r("long", 60 + 1.5 * 3000), r("after", 120)], 25 * 60);
    expect(bundles.map((b) => [b.ids, b.over])).toEqual([
      [["short"], false],
      [["long"], true],
      [["after"], false],
    ]);
  });
});

describe("districtRoutes on the data under test (B2, B3)", () => {
  const files = readExpresswayFiles();
  const districts = districtsOfFiles(files);
  const names = [
    ...new Set([...districts.entries()].filter(([id]) => files.byRun.has(id)).map(([, d]) => d)),
  ];

  for (const district of names) {
    it(`${district}: every route's places lie on chunks of the data, its walls are dead ends, twice the same`, () => {
      const table = districtRoutes(files, districts, district);
      expect(JSON.stringify(districtRoutes(files, districts, district))).toBe(JSON.stringify(table));
      expect(new Set(table.routes.map((r) => r.id)).size).toBe(table.routes.length);
      const tileRuns = new Map(
        files.runs.map((x) => [x.id, { id: x.id, cls: x.cls, start: x.start, end: x.end }]),
      );
      const rangeOf = (id: string) => rangeOfChunks(files.byRun.get(id) ?? [], STATION_STRIDE);
      for (const r of table.routes) {
        if (r.kind === "auto") {
          expect(files.byRun.get(r.entrance)?.[0].cls, r.id).toBe("ramp");
          continue;
        }
        expect(chunkAt(files.byRun, r.from), `${r.id} from`).not.toBeNull();
        for (const id of r.prefer) expect(files.byRun.has(id), `${r.id} prefer ${id}`).toBe(true);
        if (r.kind === "wall") {
          expect(endAhead(tileRuns, rangeOf, r.wall, "end").ahead, r.id).toBe(false);
          continue;
        }
        const isStreet = "street" in r.to;
        if (!isStreet)
          expect(chunkAt(files.byRun, r.to as { run: string; s: number }), `${r.id} to`).not.toBeNull();
        const length = r.prefer.reduce((a, id) => a + (files.runById.get(id)?.lengthM ?? 0), 0);
        expect(length, r.id).toBeGreaterThan(0);
      }
      expect(PIECE_M).toBe(12_000);
    });
  }
});
