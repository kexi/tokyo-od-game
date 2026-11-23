import { describe, expect, it } from "vitest";
import { readExpresswayFiles } from "../scripts/expresswayFiles";
import {
  againstMain,
  ARRIVE_M,
  exitCodeOf,
  judgeStreetDrive,
  type KnownCase,
  knownCasesOf,
  type Project,
  RIDE_BAND,
  type StreetDriveRide,
  streetDriveFailures,
  type StreetSummary,
  streetVerdict,
} from "../scripts/qa/streetDriveVerdict";
import { knownCasesFrom, projectOnRun } from "../scripts/qa/streetKnown";
import { placeLatLon, placesOf, STREET_PLACES } from "../scripts/qa/streetPlaces";
import { isReusable, type ResultKey, summarize } from "../scripts/qa/streetResults";
import type { XwChunk } from "../src/expressway/format";

// The street drive (R1-5 PR A): its verdict keeps 7c's checks and numbers, never reads a fallen,
// put-back or unmeasured drive as arrived (A2), tells a drive whose every failure lies in a ledger
// case (known) from one with any failure outside, counts neither as a pass (A3), sets a failure
// against main's result by its kinds (known-main only with no new kind), and resumes only results
// of the same run; its places table gives 7c's points on the default data.

const here = { lat: 35.67, lon: 139.74 };
const clean: StreetDriveRide = {
  started: true,
  endM: 2.1,
  fell: false,
  samples: 120,
  below: [],
  above: [],
  crossed: [],
  stalled: [],
  respawned: [],
  end: here,
};
const kinds = (ride: StreetDriveRide) => streetDriveFailures(ride).map((f) => f.kind);

describe("the street drive's verdict", () => {
  it("keeps 7c's numbers", () => {
    expect(ARRIVE_M).toBe(10);
    expect(RIDE_BAND).toEqual([0.4, 1.3]);
  });

  it("passes a drive that arrived on the street's band with nothing else", () => {
    expect(streetDriveFailures(clean)).toEqual([]);
    expect(streetDriveFailures({ ...clean, endM: 10 })).toEqual([]);
  });

  it("compares the end's distance as measured: 10.04 m has not arrived", () => {
    const f = streetDriveFailures({ ...clean, endM: 10.04 });
    expect(f.map((x) => x.kind)).toEqual(["stopped-short"]);
    expect(f[0].text).toMatch(/stopped 10 m/);
  });

  it("fails a car fallen into a cut even where it ends within ARRIVE_M (7c1's case)", () => {
    expect(kinds({ ...clean, endM: 4, below: [here, here] })).toEqual(["under"]);
  });

  it("fails a drive the game put back (car_respawned) though it ends at the end", () => {
    expect(kinds({ ...clean, respawned: [here] })).toEqual(["respawned"]);
  });

  it("fails a drive with no sample, no route, or one that stopped short", () => {
    expect(kinds({ ...clean, endM: 0, samples: 0 })).toEqual(["no-sample"]);
    expect(kinds({ ...clean, started: false, endM: 80.2, samples: 0 })).toEqual([
      "no-route",
      "no-sample",
      "stopped-short",
    ]);
  });

  it("fails a car up on a deck or a wall, a fall off a deck, a building and a stall", () => {
    const ride = { ...clean, fell: true, above: [here], crossed: [here], stalled: [here] };
    expect(kinds(ride)).toEqual(["over", "fell", "crossed", "stalled"]);
  });

  it("judges an error or a try with no ride as a failure, never a pass", () => {
    const none = () => null;
    const unplaced = judgeStreetDrive(
      { invalid: null, error: { kind: "unplaced", text: "no lane" } },
      [],
      none,
      null,
    );
    expect(unplaced.verdict).toBe("fail");
    expect(judgeStreetDrive({ invalid: null }, [], none, null).kinds).toEqual(["no-ride"]);
    expect(judgeStreetDrive({ invalid: "accident during the drive" }, [], none, null).verdict).toBe(
      "invalid",
    );
  });
});

describe("known cases (every failure inside a case of the ledger)", () => {
  const cases: KnownCase[] = [
    { key: "lane-in-site:A@100-140", run: "A", s0: 100, s1: 140, reachM: 6 },
    { key: "street-lane-over-cut:B", run: "B", s0: 0, s1: 300, reachM: 9 },
  ];
  // A fake run projection: lat is the run distance, lon the distance from the centre line.
  const project: Project = (run, lat, lon) => (run === "A" || run === "B" ? { s: lat, offM: lon } : null);
  const at = (s: number, off: number) => ({ lat: s, lon: off });

  it("is known when every point of every failure lies in a case's run distances and reach", () => {
    const ride = { ...clean, below: [at(120, 5), at(125, 5)], respawned: [at(130, 5.9)] };
    const f = streetDriveFailures(ride);
    const known = knownCasesOf(f, cases, project);
    expect(known).toEqual(["lane-in-site:A@100-140", "street-lane-over-cut:B"]);
    expect(streetVerdict(f, known)).toBe("known");
  });

  it("fails a drive that sank inside a case and crossed a building and stalled outside it (the review's case)", () => {
    const ride = { ...clean, below: [at(120, 1)], crossed: [at(500, 1)], stalled: [at(510, 1)] };
    const judged = judgeStreetDrive({ invalid: null, ride }, cases, project, null);
    expect(judged.known).toEqual([]);
    expect(judged.verdict).toBe("fail");
  });

  it("fails when a later sample off the band leaves the case, though the first is inside", () => {
    const f = streetDriveFailures({ ...clean, below: [at(120, 1), at(320, 1)] });
    expect(knownCasesOf(f, cases, project)).toEqual([]);
  });

  it("fails when a point is out of reach, and when any failure has no point (a fall, no sample)", () => {
    expect(knownCasesOf(streetDriveFailures({ ...clean, below: [at(120, 9.5)] }), cases, project)).toEqual(
      [],
    );
    const fellToo = streetDriveFailures({ ...clean, below: [at(120, 1)], fell: true });
    expect(knownCasesOf(fellToo, cases, project)).toEqual([]);
    expect(streetVerdict(fellToo, [])).toBe("fail");
  });

  it("is never a pass", () => {
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

describe("against main's result (--baseline: main's checkout driven on main's data)", () => {
  const main = (verdict: string, ...k: string[]) => ({ verdict, kinds: k });

  it("reads a failure as known-main only when main failed there with every kind of it", () => {
    expect(againstMain("fail", ["stopped-short"], main("fail", "stopped-short"))).toBe("known-main");
    expect(againstMain("fail", ["under"], main("known", "respawned", "under"))).toBe("known-main");
  });

  it("keeps a new kind a fail, though main failed at the place (a respawn where main only sank)", () => {
    expect(againstMain("fail", ["respawned", "under"], main("fail", "under"))).toBe("fail");
  });

  it("keeps a failure where main passed, was invalid or did not drive, and every other verdict", () => {
    expect(againstMain("fail", ["under"], main("pass"))).toBe("fail");
    expect(againstMain("fail", ["under"], main("invalid"))).toBe("fail");
    expect(againstMain("fail", ["under"], null)).toBe("fail");
    expect(againstMain("pass", [], main("fail", "under"))).toBe("pass");
    expect(againstMain("known", ["under"], main("fail", "under"))).toBe("known");
  });
});

describe("the run's results: resume and exit code", () => {
  const key: ResultKey = {
    metaSha256: "m",
    tilesSha256: "t",
    siteLanes: null,
    holeLanes: null,
    baseline: null,
  };
  const result = (id: string, verdict: string, k: ResultKey | undefined = key) => ({
    place: { id },
    verdict,
    key: k,
  });
  const empty: StreetSummary = { pass: [], fail: [], known: [], knownMain: [], invalid: [], missing: [] };

  it("resumes a result of the same data, case lists and baseline only", () => {
    expect(isReusable(result("a", "pass"), key)).toBe(true);
    expect(isReusable(result("a", "pass", { ...key, tilesSha256: "other" }), key)).toBe(false);
    expect(isReusable(result("a", "pass", { ...key, baseline: "/main" }), key)).toBe(false);
    expect(isReusable({ place: { id: "a" }, verdict: "pass" } as never, key)).toBe(false);
    expect(isReusable(null, key)).toBe(false);
  });

  it("counts this run's results, lists the table's places with none as missing and others' as stale", () => {
    const s = summarize(
      [result("a", "pass"), result("b", "known-main"), result("c", "fail", { ...key, metaSha256: "x" })],
      ["a", "b", "c", "d"],
      key,
    );
    expect(s).toEqual({ ...empty, pass: ["a"], knownMain: ["b"], missing: ["c", "d"], stale: ["c"] });
  });

  it("exits 1 on a failure, 2 invalid, 5 missing, 3 known, 4 known-main only, 0 all passed", () => {
    expect(exitCodeOf({ ...empty, pass: ["a"] })).toBe(0);
    expect(exitCodeOf({ ...empty, fail: ["a"], invalid: ["b"], missing: ["c"] })).toBe(1);
    expect(exitCodeOf({ ...empty, invalid: ["b"], missing: ["c"] })).toBe(2);
    expect(exitCodeOf({ ...empty, missing: ["c"], known: ["d"] })).toBe(5);
    expect(exitCodeOf({ ...empty, known: ["d"], knownMain: ["e"] })).toBe(3);
    expect(exitCodeOf({ ...empty, knownMain: ["e"] })).toBe(4);
  });
});

describe("the street places table", () => {
  const files = readExpresswayFiles();
  const isDefault = !process.env.XW_DATA_DIR;
  /**
   * 7c's points of the 18 places on the default data (48dc699), as the copy's at() gave them (the
   * same to 1e-7: .qa/r15-tools/compare-places.ts). A rebuild that moves the runs moves these too.
   */
  const SEVEN_C: Record<string, [number, number]> = {
    "azabudai-north-portal-over": [35.6602401, 139.7371503],
    "azabudai-north-portal-over-2": [35.6603679, 139.7372537],
    "wall-24039751-left": [35.6718955, 139.7439059],
    "wall-24039751-right": [35.6716963, 139.7440114],
    "wall-45068169-left": [35.6620565, 139.7619099],
    "wall-45068169-right": [35.6621764, 139.7616888],
    "wall-24402611-start": [35.6712501, 139.7434038],
    "kasumi-24402611-75": [35.6710169, 139.7429868],
    "kasumi-24402611-84": [35.6709529, 139.7429223],
    "kasumi-24402611-90": [35.6709091, 139.742878],
    "kasumi-895902565-850": [35.6709406, 139.7427937],
    "kasumi-895902565-856": [35.6709885, 139.7428422],
    "kasumi-895902565-865": [35.6710483, 139.7429025],
    "decided-895902565-80": [35.6650378, 139.738788],
    "decided-45021976-3412": [35.6582105, 139.7364125],
    "control-two-way": [35.666023, 139.750794],
    "control-one-way": [35.664318, 139.755902],
    "control-narrow": [35.664136, 139.756425],
  };

  it("has 7c's 18 places with unique ids, and refuses an id it has not", () => {
    const ids = STREET_PLACES.map((p) => p.id);
    expect(ids).toHaveLength(18);
    expect(new Set(ids).size).toBe(18);
    expect(ids.toSorted()).toEqual(Object.keys(SEVEN_C).toSorted());
    expect(placesOf(STREET_PLACES, ["control-narrow"]).map((p) => p.id)).toEqual(["control-narrow"]);
    expect(() => placesOf(STREET_PLACES, ["nowhere"])).toThrow(/unknown street places: nowhere/);
  });

  for (const p of STREET_PLACES) {
    it(`${p.id}: lies on a run of the data${isDefault ? ", at 7c's point" : ""}`, () => {
      const isRun = "run" in p.at;
      if (isRun) expect(files.byRun.has((p.at as { run: string }).run), p.id).toBe(true);
      const at = placeLatLon(files.byRun, p.at);
      expect(at).not.toBeNull();
      if (!isDefault) return;
      const [lat, lon] = SEVEN_C[p.id];
      expect(at!.lat).toBeCloseTo(lat, 6);
      expect(at!.lon).toBeCloseTo(lon, 6);
    });
  }
});
