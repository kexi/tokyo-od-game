import { describe, expect, it } from "vitest";
import type { XwChunk, XwTileRun } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import {
  expresswayRoadInput,
  isClearOfDeck,
  joinExpressway,
  LEAD_M,
  RAMP_REACH_M,
} from "../src/world/expresswayRoads";
import type { RoadDiagnostic, RoadLine } from "../src/world/roads";

// S6 PR 7c1, F1: how a ramp's ground end (its foot) is joined to the streets. A one-lane ramp R on
// the ground along the x axis near 芝公園, its foot at the origin; the deck lies on x > 0 (an
// on-ramp runs from the foot east, an off-ramp arrives at it going west), so the foot's heading out
// of the deck is −x. Its carriageway is 4.75 m (half 2.375 m).
const plane = planeAt(139.75, 35.65);
const HW = (3.25 + 1 + 0.5) / 2;

function rampChunk(entry: boolean): XwChunk {
  const st: number[] = [];
  for (let s = 0; s <= 100; s += 10) {
    const x = entry ? s : 100 - s;
    const [lon, lat] = plane.toLonLat(x, 0);
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
    h0: entry ? 0 : Math.PI,
    h1: entry ? 0 : Math.PI,
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

function rampRun(entry: boolean): XwTileRun {
  const ground = { kind: "ground" as const, ground: 3 };
  const open = { kind: "open" as const };
  return { id: "R", cls: "ramp", start: entry ? ground : open, end: entry ? open : ground };
}

const ellipsoidal = (_lat: number, _lon: number, h: number) => h;
const line = (pts: number[][], kind: RoadLine["kind"] = "local", width = 9): RoadLine => ({
  coords: pts.flatMap(([x, y]) => plane.toLonLat(x, y)),
  width,
  oneway: 0,
  kind,
});
/** Streets far round, standing for the loaded tiles (a foot is joined only inside their extent). */
const area = [
  [-600, -600, 600, -600],
  [600, -600, 600, 600],
  [600, 600, -600, 600],
  [-600, 600, -600, -600],
].map(([x0, y0, x1, y1]) =>
  line(
    [
      [x0, y0],
      [x1, y1],
    ],
    "local",
    6,
  ),
);

function joined(entry: boolean, streets: RoadLine[]) {
  const input = expresswayRoadInput([rampChunk(entry)], [rampRun(entry)], ellipsoidal);
  const reports: RoadDiagnostic[] = [];
  const lines = joinExpressway([...streets, ...area], input, (d) => reports.push(d));
  const node = input.ends[0].node;
  const connector = lines.find((l) => l.xid === undefined && l.source === "osm") ?? null;
  // The connector's points from the foot outwards (an on-ramp's is drawn street → deck).
  const pts = connector
    ? Array.from({ length: connector.coords.length / 2 }, (_, k) =>
        plane.toXY(connector.coords[k * 2], connector.coords[k * 2 + 1]),
      )
    : [];
  const fromFoot = entry ? pts.toReversed() : pts;
  return { lines, reports, connector, fromFoot, node, deck: lines.find((l) => l.xid === "R:0")! };
}

/** (out, left) of a plane point at the foot: out along −x, left of that heading (−y). */
const rel = ([x, y]: [number, number]): [number, number] => [-x, -y];

/** Points every 0.25 m along a polyline. */
function along(pts: Array<[number, number]>): Array<{ p: [number, number]; arc: number }> {
  const out: Array<{ p: [number, number]; arc: number }> = [];
  let arc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let d = 0; d < len; d += 0.25) {
      const t = d / len;
      out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], arc: arc + d });
    }
    arc += len;
  }
  out.push({ p: pts[pts.length - 1], arc });
  return out;
}

/** F1's rules 1 and 2 over a connector from the foot: never beside the deck, its first LEAD_M straight ahead. */
function expectClearAndStraight(fromFoot: Array<[number, number]>) {
  expect(fromFoot.length).toBeGreaterThan(1);
  for (const { p, arc } of along(fromFoot)) {
    const [out, left] = rel(p);
    expect(isClearOfDeck(out, left, HW), `(${out.toFixed(2)}, ${left.toFixed(2)})`).toBe(true);
    if (arc > LEAD_M) continue;
    expect(Math.abs(left), `arc ${arc.toFixed(2)}`).toBeLessThan(1e-6);
    expect(out).toBeCloseTo(arc, 6);
  }
}

describe("ランプの足の接続（S6 PR 7c1、F1）", () => {
  // A street across the heading 12 m ahead, and GSI's 高速道路 line of a neighbour 7 m beside the
  // deck, running back along it to a street behind the foot (the nearest line within 15 m of the
  // foot, which the rule before 7c1 traced there through the deck's wall: 45068171:1).
  const across = line([
    [-12, -100],
    [-12, 100],
  ]);
  const beside = line(
    [
      [-3, 7],
      [30, 7],
    ],
    "highway",
    4.3,
  );
  const behind = line([
    [30, 7],
    [30, 200],
  ]);

  it("leaves the foot straight ahead for LEAD_M and never enters beside its own deck, whatever line runs alongside", () => {
    for (const entry of [true, false]) {
      const { fromFoot, reports } = joined(entry, [across, beside, behind]);
      expect(reports).toEqual([]);
      expectClearAndStraight(fromFoot);
      // It arrives on the street across, not at the neighbour's line.
      const [x] = fromFoot[fromFoot.length - 1];
      expect(x).toBeCloseTo(-12, 1);
    }
  });

  it("still follows the ramp's own GSI line under the foot to where it meets a street (the shape before 7c1)", () => {
    // GSI's at-grade part of the ramp: from under the deck along the axis, 0.6 m off it, then bending
    // to a street corner 40 m on.
    const corner: [number, number] = [-40, -20];
    const own = line([[20, 0.6], [-15, 0.6], corner], "highway", 4.3);
    const street = line([[-40, -200], corner, [-40, 200]]);
    const { fromFoot, reports } = joined(true, [own, street]);
    expect(reports).toEqual([]);
    expectClearAndStraight(fromFoot);
    // Through GSI's own vertex at x = −15 to the corner.
    expect(fromFoot.some(([x, y]) => Math.abs(x + 15) < 0.01 && Math.abs(y - 0.6) < 0.01)).toBe(true);
    const [x, y] = fromFoot[fromFoot.length - 1];
    expect([Math.round(x), Math.round(y)]).toEqual(corner);
  });

  it("goes straight to a street the lead itself crosses (the foot in its carriageway), never turning back", () => {
    // A street at 45° whose centre line crosses the foot's axis 3 m out (23705286:start's shape).
    const slant = line([
      [-3 + 40, -40],
      [-3 - 40, 40],
    ]);
    const { fromFoot, reports } = joined(true, [slant]);
    expect(reports).toEqual([]);
    expectClearAndStraight(fromFoot);
    expect(fromFoot).toHaveLength(2);
    const [out, left] = rel(fromFoot[1]);
    expect(out).toBeCloseTo(3, 1);
    expect(Math.abs(left)).toBeLessThan(0.01);
  });

  it("joins a street that crosses the run inside the foot at the crossing: one node, no connector", () => {
    // Nothing ahead: a street crossing the deck 2.2 m in from the end face.
    const inside = line([
      [2.2, -50],
      [2.2, 50],
    ]);
    const { lines, connector, reports, deck } = joined(true, [inside]);
    expect(reports).toEqual([]);
    expect(connector).toBeNull();
    const id = "xwg:R:start";
    expect(deck.nodeIds).toContain(id);
    expect(deck.heights!.length).toBe(deck.coords.length / 2);
    const street = lines.find((l) => l.kind === "local" && l.nodeIds?.includes(id));
    expect(street).toBeDefined();
    const k = deck.nodeIds!.indexOf(id);
    const [x, y] = plane.toXY(deck.coords[k * 2], deck.coords[k * 2 + 1]);
    expect(x).toBeCloseTo(2.2, 3);
    expect(y).toBeCloseTo(0, 3);
  });

  it("joins a street crossing the run inside the foot at a slant (70°) at the crossing, not by a leg turning back", () => {
    // A 25 m street through (2.2, 0) at 70°: its nearest point ahead of the end face lies beside the
    // deck, and a leg to it turned back by ~128° before the review of 7c1.
    const a = (70 * Math.PI) / 180;
    const slant = line(
      [
        [2.2 - 60 * Math.cos(a), -60 * Math.sin(a)],
        [2.2 + 60 * Math.cos(a), 60 * Math.sin(a)],
      ],
      "local",
      25,
    );
    const { connector, reports, deck, lines } = joined(true, [slant]);
    expect(reports).toEqual([]);
    expect(connector).toBeNull();
    const id = "xwg:R:start";
    expect(deck.nodeIds).toContain(id);
    expect(lines.some((l) => l.kind === "local" && l.nodeIds?.includes(id))).toBe(true);
    const k = deck.nodeIds!.indexOf(id);
    const [x] = plane.toXY(deck.coords[k * 2], deck.coords[k * 2 + 1]);
    expect(x).toBeCloseTo(2.2, 2);
  });

  it("meets a street running alongside (a ramp in its median) at no more than 45° off the heading", () => {
    // The street's centre line 6 m to the foot's left, along the deck and on past the foot.
    const alongside = line([
      [100, -6],
      [-100, -6],
    ]);
    const { fromFoot, reports } = joined(false, [alongside]);
    expect(reports).toEqual([]);
    expectClearAndStraight(fromFoot);
    const [out, left] = rel(fromFoot[fromFoot.length - 1]);
    const lead = fromFoot.find(([x]) => Math.abs(x + LEAD_M) < 1e-6)!;
    expect(lead).toBeDefined();
    const legDeg = (Math.atan2(Math.abs(left), out - LEAD_M) * 180) / Math.PI;
    expect(legDeg).toBeLessThanOrEqual(45 + 1e-6);
    expect(Math.abs(left)).toBeCloseTo(6, 3);
  });

  it("joins an on-ramp and an off-ramp as mirror images (street → lead → foot, foot → lead → street)", () => {
    const entry = joined(true, [across]);
    const exit = joined(false, [across]);
    expect(entry.fromFoot.length).toBe(exit.fromFoot.length);
    entry.fromFoot.forEach(([x, y], k) => {
      expect(x).toBeCloseTo(exit.fromFoot[k][0], 3);
      expect(y).toBeCloseTo(exit.fromFoot[k][1], 3);
    });
    // The on-ramp's connector is drawn towards the deck, the off-ramp's away from it.
    const first = (c: RoadLine) => plane.toXY(c.coords[0], c.coords[1]);
    expect(Math.round(first(entry.connector!)[0])).toBe(-12);
    expect(Math.round(first(exit.connector!)[0])).toBe(0);
  });

  it("meets a street that runs beside the deck and parts at its foot by a T from the lead point, never turning back (250488080:end)", () => {
    // (out, left) of 250488080:end's GSI street (9 m): 7.5 m right of the deck, parting at 45° by
    // the foot. No point of it lies within 45° of the lead point in reach; the nearest ahead of the
    // end face lay beside it, and the leg turned back by 108° (review of 7c1).
    const beside = line(
      [
        [-45, -7.5],
        [-18, -7.5],
        [-7.1, -11.5],
        [2.8, -16.3],
        [10.9, -22.1],
        [20.5, -34],
      ].map(([out, left]) => [-out, -left]),
    );
    const { fromFoot, reports } = joined(false, [beside]);
    expect(reports).toEqual([]);
    expectClearAndStraight(fromFoot);
    const [lout, lleft] = rel(fromFoot[fromFoot.length - 2]);
    expect(lout).toBeCloseTo(LEAD_M, 6);
    expect(lleft).toBeCloseTo(0, 6);
    const [out, left] = rel(fromFoot[fromFoot.length - 1]);
    const legDeg = (Math.atan2(Math.abs(left - lleft), out - lout) * 180) / Math.PI;
    expect(legDeg).toBeLessThanOrEqual(90 + 1e-6);
    expect(out).toBeGreaterThanOrEqual(LEAD_M - 1e-6);
  });

  it("leaves a foot whose only street points in reach lie short of the lead point a dead end (ramp_unattached)", () => {
    // A short street 8 m right of the foot from out 0.5 to 4.5: a leg to it would turn back.
    const short = line([
      [-0.5, 8],
      [-4.5, 8],
    ]);
    const { reports, connector } = joined(false, [short]);
    expect(connector).toBeNull();
    expect(reports).toEqual([{ event: "ramp_unattached", fields: { run: "R", end: "end", reachM: 15 } }]);
  });

  it("leaves a foot with no street within reach of its lead point a dead end (ramp_unattached)", () => {
    // The street's edge 15.5 m from the lead point: its centre 20 m on.
    const far = line([
      [-LEAD_M - RAMP_REACH_M - 0.5 - 4.5, -100],
      [-LEAD_M - RAMP_REACH_M - 0.5 - 4.5, 100],
    ]);
    const { reports, connector } = joined(true, [far]);
    expect(connector).toBeNull();
    expect(reports).toEqual([{ event: "ramp_unattached", fields: { run: "R", end: "start", reachM: 15 } }]);
    // Within reach by its edge (centre 19 m from the lead point, edge 14.5 m): joined.
    const near = line([
      [-LEAD_M - 19, -100],
      [-LEAD_M - 19, 100],
    ]);
    expect(joined(true, [near]).reports).toEqual([]);
  });
});
