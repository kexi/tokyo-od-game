import { describe, expect, it } from "vitest";
import type { XwChunk, XwTileRun } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import {
  expresswayRoadInput,
  joinExpressway,
  sameRoadJudgements,
  siteBand,
  type XwSite,
} from "../src/world/expresswayRoads";
import type { RoadDiagnostic, RoadLine } from "../src/world/roads";

// A plane round (139.75, 35.65): x east, y north (m). Sites and streets drawn in it.
const plane = planeAt(139.75, 35.65);
const ll = (x: number, y: number) => plane.toLonLat(x, y);
const xy = plane.toXY;
const street = (pts: Array<[number, number]>, width = 4.3): RoadLine => ({
  coords: pts.flatMap(([x, y]) => ll(x, y)),
  width,
  oneway: 0,
  kind: "local",
});
/**
 * A ramp's at-grade chunk along y = `y` from x 0 to 200, its slab 2.875 m either side (the band,
 * with SITE_CLEARANCE_M, 3.875 m: the default range's 4848755:0), its run meeting the ground at x 0.
 */
const site = (chunk: string, y = 0, ends: number[] = [0], extra: Partial<XwSite> = {}): XwSite => {
  const coords: number[] = [];
  const s: number[] = [];
  for (let x = 0; x <= 200; x += 10) {
    coords.push(...ll(x, y));
    s.push(x);
  }
  return {
    chunk,
    coords,
    s,
    z: s.map(() => 11),
    ground: s.map(() => 10),
    halfWidth: 2.875,
    ends,
    prev: null,
    next: null,
    ...extra,
  };
};
const judgementOf = (lines: RoadLine[], sites: XwSite[], line: RoadLine) =>
  sameRoadJudgements(lines, sites, xy).find((j) => j.street === lines.indexOf(line)) ?? null;
const verdictOf = (lines: RoadLine[], sites: XwSite[], line: RoadLine) =>
  judgementOf(lines, sites, line)?.verdict ?? null;

describe("the same-road rule (P2.7 R1-2b M1, α): a line at a time", () => {
  it("takes out a thin line wholly inside the band along the site", () => {
    const thin = street([
      [20, 0.2],
      [180, 0.2],
    ]);
    expect(verdictOf([thin], [site("A:0")], thin)).toBe("alpha");
  });

  it("keeps a line along the band but only partly inside it (9 m, 1.3 m off the site's centre)", () => {
    const wide = street(
      [
        [20, 1.3],
        [180, 1.3],
      ],
      9,
    );
    expect(verdictOf([wide], [site("A:0")], wide)).toBe("partial");
  });

  it("keeps a line wholly within SITE_END_REACH_M of where the run meets the ground (the ramp's own street)", () => {
    const foot = street([
      [2, 0.2],
      [12, 0.2],
      [20, -50],
    ]);
    expect(verdictOf([foot], [site("A:0")], foot)).toBe("at-foot");
  });

  it("takes out a long line reaching into the foot whole, not leaving its first 15 m in the band", () => {
    const long = street([
      [2, 0.2],
      [150, 0.2],
    ]);
    const j = judgementOf([long], [site("A:0")], long)!;
    expect(j.verdict).toBe("alpha");
    expect(j.stretches[0].l0).toBe(0);
  });

  it("keeps a class 0 line (under 3 m: no width to judge)", () => {
    const narrow = street(
      [
        [20, 0],
        [180, 0],
      ],
      2.5,
    );
    expect(verdictOf([narrow], [site("A:0")], narrow)).toBe("class-0");
  });

  it("keeps a line with fewer than MIN_LENGTH_M samples inside (short)", () => {
    const stub = street([
      [50, 0.2],
      [51.5, 0.2],
    ]);
    expect(verdictOf([stub], [site("A:0")], stub)).toBe("short");
  });

  it("never merges the bands of separate runs: a street between two ramps is judged, and is a road of its own", () => {
    const between = street(
      [
        [20, 0],
        [180, 0],
      ],
      9,
    );
    const j = judgementOf([between], [site("A:0", 3), site("B:0", -3)], between);
    expect(j).not.toBeNull();
    expect(j!.verdict).not.toBe("alpha");
  });

  it("judges a run's adjacent chunks as one site: a sample along the next chunk but not inside it makes the line partial", () => {
    // A:0 along y = 0 (x 0–200), A:1 going on along y = 0 (x 200–400) but its slab narrower, so a
    // sample over A:1 has the band (1.5 + 1 m) short of the 4.3 m street's least width (3 m)… inside
    // A:0 only while over it.
    const a1coords: number[] = [];
    const a1s: number[] = [];
    for (let x = 200; x <= 400; x += 10) {
      a1coords.push(...ll(x, 0));
      a1s.push(x);
    }
    const a0 = site("A:0", 0, [0], { next: "A:1" });
    const a1: XwSite = {
      ...site("A:1", 0, []),
      coords: a1coords,
      s: a1s,
      halfWidth: 0.2,
      prev: "A:0",
      next: null,
    };
    const line = street([
      [100, 0.2],
      [260, 0.2],
    ]);
    const j = judgementOf([line], [a0, a1], line)!;
    expect(j.chunks.toSorted()).toEqual(["A:0", "A:1"]);
    expect(j.verdict).toBe("partial");
  });
});

describe("the same-road rule judges a line by its shape alone, not by what it joins (追記 3 F2)", () => {
  // Why not keep a line whose taking out cuts a street off (追記 2 D2): following the network gave
  // one line different answers in different windows of the streets read; islands are PR 3's.
  it("takes out an alpha line even when the street beyond its end is left cut off", () => {
    const line = street([
      [20, 0.2],
      [180, 0.2],
    ]);
    const stub = street([
      [180, 0.2],
      [180, 60],
    ]);
    expect(verdictOf([line, stub], [site("A:0")], line)).toBe("alpha");
  });

  it("takes out both of two alpha lines in a row, each on its own samples", () => {
    const a = street([
      [20, 0.2],
      [100, 0.2],
    ]);
    const b = street([
      [100, 0.2],
      [180, 0.2],
    ]);
    const lines = [a, b];
    const judged = sameRoadJudgements(lines, [site("A:0")], xy);
    const of = (l: RoadLine) => judged.find((j) => j.street === lines.indexOf(l))?.verdict;
    expect([of(a), of(b)]).toEqual(["alpha", "alpha"]);
  });
});

describe("the band as a test on points (siteBand, 追記 4 K2)", () => {
  // A site bending 30° left at x 50: (0, 0) → (50, 0) → on at 30°.
  const bent = (): XwSite => {
    const pts: Array<[number, number]> = [
      [0, 0],
      [50, 0],
      [50 + 50 * Math.cos(Math.PI / 6), 50 * Math.sin(Math.PI / 6)],
    ];
    return {
      ...site("A:0", 0, []),
      coords: pts.flatMap(([x, y]) => ll(x, y)),
      s: [0, 50, 100],
    };
  };

  it("holds a point outside a bend's vertex, where no segment takes the foot of its perpendicular", () => {
    const band = siteBand([bent()], xy);
    // 2 m out from the vertex on the outer side of the bend: off both segments' spans.
    expect(band(50 + 2 * Math.sin(Math.PI / 12), -2 * Math.cos(Math.PI / 12)).isInside).toBe(true);
  });

  it("leaves out the cap beyond the chain's ends, and marks a point at the foot", () => {
    const band = siteBand([site("A:0")], xy);
    expect(band(-2, 0).isInside).toBe(false);
    expect(band(5, 1).isInside).toBe(true);
    expect(band(5, 1).isAtFoot).toBe(true);
    expect(band(50, 1).isAtFoot).toBe(false);
  });
});

// Through joinExpressway: a one-lane on-ramp R on the ground along the x axis, its foot at the origin
// (as tests/expresswayRampFeet.test.ts), slab 2.375 + 0.5 m either side, band 3.875 m. `bent`: the
// ramp turns 30° left at x 50 (stations every 10 m along it).
function rampChunk(bent = false): XwChunk {
  const st: number[] = [];
  for (let s = 0; s <= 100; s += 10) {
    const isPastBend = bent && s > 50;
    const a = Math.PI / 6;
    const [x, y] = isPastBend ? [50 + (s - 50) * Math.cos(a), (s - 50) * Math.sin(a)] : [s, 0];
    const [lon, lat] = ll(x, y);
    st.push(s, lon, lat, 3, 0, 3, 0);
  }
  return {
    id: "R:0",
    run: "R",
    chain: "R",
    k: 0,
    cls: "ramp",
    ref: null,
    name: null,
    structure: "embankment",
    over: null,
    lanes: 1,
    laneWidth: 3.25,
    shoulderL: 1,
    shoulderR: 0.5,
    basis: "assumption",
    V: 40,
    maxspeed: 40,
    vh: 40,
    gmax: 0.05,
    g0: 0,
    g1: 0,
    h0: 0,
    h1: 0,
    girder: 2.2,
    st,
    piers: [],
    cross: [],
    blocked: [],
    decks: [],
    prev: null,
    next: null,
  };
}
const rampRun: XwTileRun = {
  id: "R",
  cls: "ramp",
  start: { kind: "ground", ground: 3 },
  end: { kind: "seam", parent: "X", parentS: 0 },
};
/** Streets far round, standing for the loaded tiles (a foot is joined only inside their extent). */
const area = [
  [-600, -600, 600, -600],
  [600, -600, 600, 600],
  [600, 600, -600, 600],
  [-600, 600, -600, -600],
].map(([x0, y0, x1, y1]) =>
  street(
    [
      [x0, y0],
      [x1, y1],
    ],
    6,
  ),
);
const BAND_M = 2.375 + 0.5 + 1;
function joined(streets: RoadLine[], bent = false) {
  const input = expresswayRoadInput([rampChunk(bent)], [rampRun], (_lat, _lon, h) => h);
  const reports: RoadDiagnostic[] = [];
  const lines = joinExpressway([...streets, ...area], input, (d) => reports.push(d));
  return {
    lines,
    reports,
    input,
    connectors: lines.filter((l) => l.xid === undefined && l.source === "osm"),
  };
}
const pointsOf = (l: RoadLine) =>
  Array.from({ length: l.coords.length / 2 }, (_, k) => xy(l.coords[k * 2], l.coords[k * 2 + 1]));
const lengthOf = (l: RoadLine) => {
  const p = pointsOf(l);
  let n = 0;
  for (let i = 1; i < p.length; i++) n += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return n;
};
/** The 4.3 m GSI lines left with a point inside the ramp's band (x 0–100, |y| within the band). */
const leftInBand = (lines: RoadLine[]) =>
  lines.filter(
    (l) =>
      l.xid === undefined &&
      l.source !== "osm" &&
      l.width === 4.3 &&
      pointsOf(l).some(([x, y]) => x > 0 && x < 100 && Math.abs(y) < BAND_M - 0.01),
  );

/**
 * Points of the 4.3 m GSI lines left that lie inside the ramp's band and not at its foot (siteBand,
 * the K4 2 count), sampled every 0.25 m with both ends.
 */
const insideNotFoot = (lines: RoadLine[], sites: XwSite[]) => {
  const band = siteBand(sites, xy);
  const out: Array<[number, number]> = [];
  for (const l of lines) {
    const isGsiStreet = l.xid === undefined && l.source !== "osm" && l.width === 4.3;
    if (!isGsiStreet) continue;
    const p = pointsOf(l);
    for (let i = 1; i < p.length; i++) {
      const [a, b] = [p[i - 1], p[i]];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25));
      for (let k = 0; k <= n; k++) {
        const q: [number, number] = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        const place = band(...q);
        const isCounted = place.isInside && !place.isAtFoot;
        if (isCounted) out.push(q);
      }
    }
  }
  return out;
};

describe("what joinExpressway leaves of an alpha line (追記 4 K2, K4 7)", () => {
  it("cuts a leg coming in from outside the band at its first sample outside: the piece left starts outside the band", () => {
    // From 12 m out at 87° into the band at x 50, then along to x 90 (the re-review's exit.mts).
    const line = street([
      [49.4, 12],
      [50, 0.3],
      [90, 0.3],
    ]);
    const away = street(
      [
        [49.4, 12],
        [49.4, 60],
      ],
      6,
    );
    const { lines, input } = joined([line, away]);
    expect(insideNotFoot(lines, input.sites ?? [])).toEqual([]);
    expect(lines.filter((l) => l.width === 4.3 && l.xid === undefined && l.source !== "osm")).toHaveLength(1);
  });

  it("cuts a leg going out at the line's far end at its first sample outside the band", () => {
    const line = street([
      [40, 0.3],
      [80, 0.3],
      [80.6, 12],
    ]);
    const away = street(
      [
        [80.6, 12],
        [80.6, 60],
      ],
      6,
    );
    const { lines, input } = joined([line, away]);
    expect(insideNotFoot(lines, input.sites ?? [])).toEqual([]);
    expect(lines.filter((l) => l.width === 4.3 && l.xid === undefined && l.source !== "osm")).toHaveLength(1);
  });

  it("takes out a piece outside a bend's vertex (no segment takes the foot of its perpendicular there): nothing left in the band", () => {
    // Along the first leg (y −0.3), then out past the outer side of the 30° bend at x 50, then away.
    const line = street([
      [20, -0.3],
      [48, -0.3],
      [50 + 2 * Math.sin(Math.PI / 12), -2 * Math.cos(Math.PI / 12)],
      [51, -20],
    ]);
    const away = street(
      [
        [51, -20],
        [51, -60],
      ],
      6,
    );
    const { lines, input } = joined([line, away], true);
    expect(insideNotFoot(lines, input.sites ?? [])).toEqual([]);
  });

  it("takes out the part bending off the site inside the band (212's shape): no piece of the line is left in the band, and the report says so", () => {
    // Bends in at 72° from (29.3, 2.4) to (30, 0.3), then along the site to (80, 0.3).
    const line = street([
      [29.3, 2.4],
      [30, 0.3],
      [80, 0.3],
    ]);
    const away = street(
      [
        [29.3, 2.4],
        [29.3, 60],
      ],
      6,
    );
    const { lines, reports } = joined([line, away]);
    expect(leftInBand(lines)).toEqual([]);
    // The report gives the length taken out, carried on into the band: the whole line (2.2 + 50 m).
    const lengths = reports.flatMap((r) =>
      r.event === "street_cut_at_expressway" && r.fields.kind === "same-road" ? [r.fields.lengthM] : [],
    );
    expect(lengths).toEqual([Math.round(lengthOf(line) * 10) / 10]);
  });

  it("leaves the part bending into the ramp's mouth at the foot (207535709's shape), and the foot joins as with that piece alone", () => {
    // From the street at (6, -12) in at 73° to (9, -0.3) inside the foot's reach, then along to (60, -0.3).
    const inMouth: Array<[number, number]> = [
      [6, -12],
      [9, -0.3],
    ];
    const line = street([...inMouth, [60, -0.3]]);
    const feeder = street(
      [
        [6, -12],
        [-40, -12],
      ],
      6,
    );
    const withLine = joined([line, feeder]);
    const pieces = withLine.lines.filter((l) => l.width === 4.3 && l.xid === undefined && l.source !== "osm");
    expect(pieces).toHaveLength(1);
    const [start, end] = [pointsOf(pieces[0])[0], pointsOf(pieces[0]).at(-1)!];
    expect(start[0]).toBeCloseTo(6, 3);
    expect(end[0]).toBeGreaterThan(8.5);
    expect(end[0]).toBeLessThan(10.5);
    // The foot's connector as when the street ends in the mouth by itself.
    const alone = joined([street(inMouth), feeder]);
    expect(withLine.connectors.map(pointsOf)).toEqual(alone.connectors.map(pointsOf));
    expect(withLine.reports.filter((r) => r.event === "ramp_unattached")).toEqual([]);
  });

  it("keeps a piece of 1.00 m left past a crossing's cut, as before (the 1 m floor is not moved)", () => {
    // A street across the ramp at x 50 (90°): the cut takes out the band (3.875 m) either side, so a
    // street ending 1.0005 m beyond it leaves a piece of 1.00 m there (212's piece was 1.00 m; a
    // fixture of 1 m to the last digit falls a hair under it in the plane's floating point).
    const cross = street([
      [50, -(BAND_M + 1.0005)],
      [50, 40],
    ]);
    const { lines } = joined([cross]);
    const south = lines.filter(
      (l) => l.width === 4.3 && l.xid === undefined && pointsOf(l).every(([, y]) => y < 0),
    );
    expect(south).toHaveLength(1);
    expect(lengthOf(south[0])).toBeCloseTo(1, 2);
  });
});
