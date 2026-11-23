import { describe, expect, it } from "vitest";
import { readExpresswayFiles } from "../scripts/expresswayFiles";
import {
  ARRIVE_M,
  type KnownCase,
  knownCasesOf,
  RIDE_BAND,
  type StreetDriveRide,
  streetDriveFailures,
  streetVerdict,
} from "../scripts/qa/streetDriveVerdict";
import { knownCasesFrom, projectOnRun } from "../scripts/qa/streetKnown";
import { placeLatLon, placesOf, STREET_PLACES } from "../scripts/qa/streetPlaces";
import type { XwChunk } from "../src/expressway/format";

// The street drive (R1-5 PR A): its verdict keeps 7c's checks and numbers, never reads a fallen,
// put-back or unmeasured drive as arrived (A2), tells a failure inside a ledger case (known) from one
// outside it, and counts neither as a pass (A3); its places table names runs the data has.

const clean: StreetDriveRide = {
  started: true,
  endM: 2.1,
  fell: false,
  over: { n: 120, below: 0, above: 0 },
  crossed: 0,
  stalled: 0,
  respawned: 0,
};

describe("the street drive's verdict", () => {
  it("keeps 7c's numbers", () => {
    expect(ARRIVE_M).toBe(10);
    expect(RIDE_BAND).toEqual([0.4, 1.3]);
  });

  it("passes a drive that arrived on the street's band with nothing else", () => {
    expect(streetDriveFailures(clean)).toEqual([]);
    expect(streetDriveFailures({ ...clean, endM: 10 })).toEqual([]);
  });

  it("fails a car fallen into a cut even where it ends within ARRIVE_M (7c1's case)", () => {
    const fallen = { ...clean, endM: 4, over: { n: 120, below: 31, above: 0 } };
    expect(streetDriveFailures(fallen)).toEqual([expect.stringMatching(/under the ground's band/)]);
  });

  it("fails a drive the game put back (car_respawned) though it ends at the end", () => {
    expect(streetDriveFailures({ ...clean, respawned: 1 })).toEqual([
      expect.stringMatching(/car_respawned 1/),
    ]);
  });

  it("fails a drive with no sample, no route, or one that stopped short", () => {
    const unmeasured = { ...clean, endM: 0, over: { n: 0, below: 0, above: 0 } };
    expect(streetDriveFailures(unmeasured)).toEqual([expect.stringMatching(/no sample/)]);
    const noRoute = { ...clean, started: false, endM: 80.2, over: { n: 0, below: 0, above: 0 } };
    expect(streetDriveFailures(noRoute)).toHaveLength(3);
    expect(streetDriveFailures({ ...clean, endM: 10.1 })).toEqual([expect.stringMatching(/stopped 10.1 m/)]);
  });

  it("fails a car up on a deck or a wall, a fall off a deck, a building and a stall", () => {
    const f = streetDriveFailures({
      ...clean,
      fell: true,
      over: { n: 9, below: 0, above: 2 },
      crossed: 1,
      stalled: 1,
    });
    expect(f).toHaveLength(4);
  });
});

describe("known cases (a failure inside a case of the ledger)", () => {
  const cases: KnownCase[] = [
    { key: "lane-in-site:A@100-140", run: "A", s0: 100, s1: 140, reachM: 6 },
    { key: "street-lane-over-cut:B", run: "B", s0: 0, s1: 300, reachM: 9 },
  ];
  // A fake run projection: lat is the run distance, lon the distance from the centre line.
  const project = (run: string, lat: number, lon: number) =>
    run === "A" || run === "B" ? { s: lat, offM: lon } : null;

  it("is known when every fault lies in a case's run distances and reach", () => {
    const faults = [
      { what: "under the band", lat: 120, lon: 5 },
      { what: "respawned (underground)", lat: 130, lon: 5.9 },
    ];
    const known = knownCasesOf(faults, cases, project);
    expect(known).toEqual(["lane-in-site:A@100-140", "street-lane-over-cut:B"]);
    expect(streetVerdict(["under the ground's band"], known)).toBe("known");
  });

  it("fails when a fault lies outside every case (past the run distances, or out of reach)", () => {
    expect(knownCasesOf([{ what: "x", lat: 320, lon: 1 }], cases, project)).toEqual([]);
    expect(knownCasesOf([{ what: "x", lat: 120, lon: 9.5 }], cases, project)).toEqual([]);
    const mixed = [
      { what: "in", lat: 120, lon: 1 },
      { what: "out", lat: 500, lon: 1 },
    ];
    expect(knownCasesOf(mixed, cases, project)).toEqual([]);
    expect(streetVerdict(["x"], [])).toBe("fail");
  });

  it("is never a pass, and a failure with no fault point (no route) is no known case", () => {
    expect(streetVerdict([], [])).toBe("pass");
    expect(knownCasesOf([], cases, project)).toEqual([]);
  });

  it("takes each case's reach from the probe's own (slab edge and parapet; hole and margin)", () => {
    const chunk = (id: string, structure: XwChunk["structure"], s0: number, s1: number) =>
      ({
        id,
        run: id.split(":")[0],
        k: Number(id.split(":")[1]),
        structure,
        lanes: 2,
        laneWidth: 3.5,
        shoulderL: 1,
        shoulderR: 1.25,
        st: [s0, 139.7, 35.6, 0, 0, 0, 0, s1, 139.7, 35.601, 0, 0, 0, 0],
      }) as unknown as XwChunk;
    const byRun = new Map([
      ["A", [chunk("A:0", "embankment", 0, 200)]],
      ["B", [chunk("B:0", "viaduct", 0, 100), chunk("B:1", "cut", 100, 250), chunk("B:2", "cut", 250, 400)]],
    ]);
    const site = [{ run: "A", chunk: "A:0", s0: 20, s1: 60, lengthM: 40, streetM: 9, nearestM: 1, lanes: 2 }];
    const hole = [{ run: "B", holeHalfM: 6.4, lanes: [] }];
    expect(knownCasesFrom(site, hole, byRun)).toEqual([
      { key: "lane-in-site:A@20-60", run: "A", s0: 20, s1: 60, reachM: (2 * 3.5 + 1 + 1.25) / 2 + 0.5 },
      { key: "street-lane-over-cut:B", run: "B", s0: 100, s1: 400, reachM: 6.4 + 1 },
    ]);
    expect(() => knownCasesFrom([{ ...site[0], chunk: "A:9" }], [], byRun)).toThrow(/no chunk A:9/);
  });

  it("puts a point on a run: its run distance and distance from the line, null past the ends", () => {
    const c = {
      id: "R:0",
      run: "R",
      k: 0,
      st: [0, 139.7, 35.6, 0, 0, 0, 0, 111.32, 139.7, 35.601, 0, 0, 0, 0],
    } as unknown as XwChunk;
    const byRun = new Map([["R", [c]]]);
    const p = projectOnRun(byRun, "R", 35.6005, 139.70005);
    expect(p!.s).toBeCloseTo(55.66, 1);
    expect(p!.offM).toBeCloseTo(4.53, 1);
    expect(projectOnRun(byRun, "R", 35.599, 139.7)).toBeNull();
    expect(projectOnRun(byRun, "nowhere", 35.6, 139.7)).toBeNull();
  });
});

describe("the street places table", () => {
  const files = readExpresswayFiles();

  it("has 7c's 18 places with unique ids, and refuses an id it has not", () => {
    const ids = STREET_PLACES.map((p) => p.id);
    expect(ids).toHaveLength(18);
    expect(new Set(ids).size).toBe(18);
    expect(placesOf(STREET_PLACES, ["control-narrow"]).map((p) => p.id)).toEqual(["control-narrow"]);
    expect(() => placesOf(STREET_PLACES, ["nowhere"])).toThrow(/unknown street places: nowhere/);
  });

  for (const p of STREET_PLACES) {
    it(`${p.id}: lies on a run of the data (or is a point of its own)`, () => {
      const isRun = "run" in p.at;
      if (isRun) expect(files.byRun.has((p.at as { run: string }).run), p.id).toBe(true);
      const at = placeLatLon(files.byRun, p.at);
      expect(at).not.toBeNull();
      expect(Number.isFinite(at!.lat) && Number.isFinite(at!.lon)).toBe(true);
    });
  }
});
