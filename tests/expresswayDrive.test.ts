import RAPIER from "@dimforge/rapier3d-compat";
import { Scene, Vector3 } from "three";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PARAPET_WIDTH } from "../src/expressway/assumptions";
import { XW_VERSION, type XwChunk, type XwMeta, type XwRunSummary } from "../src/expressway/format";
import { packTiles } from "../src/expressway/files";
import { DEFAULT_DATA_DIR, readExpresswayFiles } from "../scripts/expresswayFiles";
import { LET_GO_MAX_STEP_M } from "../src/expressway/allowlist";
import { isAutoAccepted, seamCases, withinCap } from "../src/expressway/ledger";
import { planeAt } from "../src/expressway/geo";
import { LocalFrame } from "../src/geo/frame";
import { MARKING_DIMENSIONS } from "../src/law/roadStandards";
import {
  createDeckBody,
  deckArraySteps,
  ExpresswayDecks,
  type GeoToLocal,
  HOLD_MAX_MS,
} from "../src/world/expresswayDeck";
import { ALL_GROUPS, BUILDING_GROUPS, GROUND_QUERY_GROUPS, PROP_GROUPS } from "../src/physics/groups";
import { DeckIndex, type DeckSide, planDeckMarkings, type RingSides } from "../src/world/expresswayMarkings";
import {
  chunkRings,
  MERGE_FULL_DZ,
  MERGE_MAX_DZ,
  MERGE_RAMP,
  MERGE_SKIRT,
} from "../src/world/expresswayMerge";
import { framesOf, probeGenerated } from "../scripts/expresswaySeams";
import { frameAt, surfaceHeight } from "../src/expressway/profile";
import { expresswayRoadInput, joinExpressway, type XwRoadInput } from "../src/world/expresswayRoads";
import { laneCentreOffset, sectionWidth } from "../src/world/laneChange";
import { computeRoadNetwork, restoreRoadNetwork } from "../src/world/roadNetworkData";
import { RoadNetworkBuilder } from "../src/world/roadNetworkBuilder";
import type { RoadNetworkRequest } from "../src/world/roadNetworkData";
import { leftOf, RoadGraph, type RoadDiagnostic, type RoadLine, speedLimit } from "../src/world/roads";

beforeAll(() => RAPIER.init());

// Synthetic test section near 芝公園: a main line A going east over two chunks on a crest, and a
// one-lane ramp R that starts on the ground south-west of it and ends on A's centreline at s = 300.
const plane = planeAt(139.75, 35.65);
const N = 36.9; // a constant geoid
const frame = new LocalFrame(35.65, 139.751, 40);
const place = (f: LocalFrame): GeoToLocal => ({ frame: f, ellipsoidal: (_lat, _lon, h) => h + N });
const ellipsoidal = (_lat: number, _lon: number, h: number) => h + N;

/** Elevation and grade of A: a 400 m crest of radius 1400 m peaking at s = 200, T.P. 12 m there. */
const zA = (s: number) => 12 - (s - 200) ** 2 / 2800;
const gA = (s: number) => -(s - 200) / 1400;

function chunkOf(
  id: string,
  run: string,
  s0: number,
  s1: number,
  step: number,
  at: (s: number) => [number, number, number, number],
): XwChunk {
  const st: number[] = [];
  for (let s = s0; s <= s1 + 1e-9; s += step) {
    const [x, y, z, g] = at(s);
    const [lon, lat] = plane.toLonLat(x, y);
    st.push(s, lon, lat, z, 0, 3, g);
  }
  const k = Number(id.split(":")[1]);
  return {
    id,
    run,
    chain: run,
    k,
    cls: run === "R" ? "ramp" : "expressway",
    ref: run === "R" ? null : "C1",
    name: null,
    structure: "viaduct",
    over: null,
    lanes: run === "R" ? 1 : 2,
    laneWidth: 3.25,
    shoulderL: run === "R" ? 1 : 1.25,
    shoulderR: run === "R" ? 0.5 : 0.75,
    basis: run === "R" ? "assumption" : "statute",
    V: 60,
    maxspeed: run === "R" ? 40 : 50,
    vh: 50,
    gmax: 0.05,
    g0: at(s0)[3],
    g1: at(s1)[3],
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

function section(): { chunks: XwChunk[]; runs: XwRunSummary[] } {
  const a0 = chunkOf("A:0", "A", 0, 200, 20, (s) => [s, 0, zA(s), gA(s)]);
  const a1 = chunkOf("A:1", "A", 200, 400, 20, (s) => [s, 0, zA(s), gA(s)]);
  a0.next = "A:1";
  a1.prev = "A:0";
  // The ramp climbs straight from (150, −40) on the ground to A's centreline at (300, 0).
  const len = Math.hypot(150, 40);
  const dir = [150 / len, 40 / len];
  const zEnd = zA(300);
  const r0 = chunkOf("R:0", "R", 0, len, len / 10, (s) => {
    const t = s / len;
    // A cubic from the ground (T.P. 3 m, level) to A's height there, level with A's grade along it.
    const z = 3 + (zEnd - 3) * (3 * t * t - 2 * t * t * t);
    const g = ((zEnd - 3) * (6 * t - 6 * t * t)) / len;
    return [150 + dir[0] * s, -40 + dir[1] * s, z, g];
  });
  const heading = Math.atan2(40, 150);
  r0.h0 = heading;
  r0.h1 = heading;
  const end = (kind: "ground" | "junction" | "open", extra = {}) => ({ kind, ...extra });
  const summary = (id: string, cls: "expressway" | "ramp", chunks: string[], start: object, finish: object) =>
    ({
      id,
      chain: id,
      cls,
      ref: null,
      lengthM: 0,
      V: 60,
      tagV: cls === "ramp" ? 40 : 50,
      planV: 60,
      minRadiusM: 0,
      maxShiftM: 0,
      steps: [],
      start,
      end: finish,
      chunks,
      structure: null,
    }) as XwRunSummary;
  return {
    chunks: [a0, a1, r0],
    runs: [
      summary("A", "expressway", ["A:0", "A:1"], end("open"), end("open")),
      summary("R", "ramp", ["R:0"], end("ground"), end("junction", { parent: "A", parentS: 300 })),
    ],
  };
}

function built(chunk: XwChunk, f = frame, context: { index: DeckIndex } | null = null) {
  const steps = deckArraySteps(chunk, place(f), false, context);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

const worlds: RAPIER.World[] = [];
afterEach(() => worlds.splice(0).forEach((w) => w.free()));
function worldWith(chunks: XwChunk[], f = frame) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  worlds.push(world);
  for (const c of chunks) {
    const b = built(c, f);
    createDeckBody(world, b.collider, b.piers, null);
  }
  world.step();
  return world;
}
const down = (world: RAPIER.World, x: number, y: number, z: number) => {
  const hit = world.castRay(new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 }), 40, true);
  return hit ? y - hit.timeOfImpact : null;
};

/**
 * Streets far round the section, standing for the loaded GSI tiles: a ramp end is joined or
 * reported only inside their extent (outside, its street is not loaded yet).
 */
const area: RoadLine[] = [
  [-600, -600, 900, -600],
  [900, -600, 900, 600],
  [900, 600, -600, 600],
  [-600, 600, -600, -600],
].map(([x0, y0, x1, y1]) => ({
  coords: [...plane.toLonLat(x0, y0), ...plane.toLonLat(x1, y1)],
  width: 6,
  oneway: 0,
  kind: "local",
}));

function graphOf(input: XwRoadInput, streets: RoadLine[] = [], reports: RoadDiagnostic[] = []) {
  return new RoadGraph(
    joinExpressway(streets, input, (d) => reports.push(d)),
    frame,
  );
}

describe("T11: the collider is the graph's surface (knowledge/road-redesign-plan.md 4.4)", () => {
  const { chunks, runs } = section();
  const world = () => worldWith(chunks);
  const graph = graphOf(expresswayRoadInput(chunks, runs, ellipsoidal));

  it("puts the collider within 1 cm of surfaceY all along every segment's centreline", () => {
    const own = new Map(chunks.map((c) => [c.id, worldWith([c])]));
    let checked = 0;
    for (const seg of graph.segments.filter((s) => s.line.xid)) {
      // Off the rings (stations every 20 m fall on 0.5 m steps): a ray exactly along a shared edge
      // may slip between its two triangles, which no wheel ray does twice in a row.
      for (let s = 0.013; s < seg.length; s += 0.5) {
        const { pos } = graph.sample(seg, s);
        const y = graph.surfaceY(seg, s)!;
        // Its own deck only: near the nose the synthetic ramp runs under the main line.
        const hit = down(own.get(seg.line.xid!)!, pos.x, y + 2, pos.z);
        expect(hit, `${seg.line.xid} s ${s.toFixed(1)} of ${seg.length.toFixed(1)}`).not.toBeNull();
        expect(Math.abs(hit! - y)).toBeLessThanOrEqual(0.01);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(900);
  });

  it("leaves no hole in a 0.5 m grid of rays over each carriageway", () => {
    const w = world();
    for (const seg of graph.segments.filter((s) => s.line.xid)) {
      const half = sectionWidth(seg.line.section!) / 2;
      for (let s = 0.25; s < seg.length; s += 0.5) {
        const { pos, dir } = graph.sample(seg, s);
        const y = graph.surfaceY(seg, s)!;
        for (let u = -half + 0.1; u <= half - 0.1; u += 0.5) {
          const p = pos.clone().add(leftOf(dir, u));
          expect(down(w, p.x, y + 2, p.z), `${seg.line.xid} s ${s} u ${u}`).not.toBeNull();
        }
      }
    }
  });

  it("joins consecutive chunks with no step over 1 mm across the carriageway", () => {
    const w = world();
    const a0 = graph.segments.find((s) => s.line.xid === "A:0")!;
    const seam = graph.sample(a0, a0.length);
    for (let u = -3.5; u <= 3.5; u += 0.5) {
      const before = seam.pos.clone().add(leftOf(seam.dir, u)).addScaledVector(seam.dir, -0.01);
      const after = seam.pos.clone().add(leftOf(seam.dir, u)).addScaledVector(seam.dir, 0.01);
      const ya = down(w, before.x, 20, before.z)!;
      const yb = down(w, after.x, 20, after.z)!;
      // Over 2 cm of a crest's grade of ≤ 0.15 %: the surface itself moves by under 0.03 mm.
      expect(Math.abs(ya - yb)).toBeLessThanOrEqual(0.001);
    }
  });

  it("keeps the deck where it was in the world after a change of origin (reanchored body)", () => {
    const next = new LocalFrame(35.6503, 139.7525, 42);
    const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worlds.push(w);
    const b = built(chunks[0], frame);
    createDeckBody(w, b.collider, b.piers, {
      matrix: next.transformFrom(frame),
      rotation: next.rotationFrom(frame),
    });
    w.step();
    // Points of the surface in the new frame, from lon/lat and the shared surface's height. Off
    // the rings' edges: a ray exactly along a shared edge may slip between its two triangles.
    for (const s of [10.3, 57.1, 110.3, 151.7, 190.9]) {
      const f = frameAt(chunks[0].st, s);
      const p = next.toLocal(f.lat, f.lon, f.z + N);
      const hit = down(w, p.x, p.y + 2, p.z);
      expect(hit, `s ${s}`).not.toBeNull();
      // The face is the chord between rings (≤ 1 cm from the curve, profile.ts).
      expect(Math.abs(hit! - p.y)).toBeLessThanOrEqual(0.01);
    }
  });
});

describe("the chunks in the road graph (層・ランプ・端点 ID)", () => {
  const { chunks, runs } = section();
  const input = expresswayRoadInput(chunks, runs, ellipsoidal);

  it("gives every chunk one line on level 1, with the section, the run's posted speed and heights", () => {
    expect(input.lines.map((l) => l.xid)).toEqual(["A:0", "A:1", "R:0"]);
    for (const l of input.lines) {
      expect(l).toMatchObject({ source: "osm", structure: "viaduct", level: 1, oneway: 1 });
      expect(l.heights).toHaveLength(l.coords.length / 2);
      expect(l.width).toBeCloseTo(sectionWidth(l.section!), 12);
    }
    const graph = graphOf(input);
    const ramp = graph.segments.find((s) => s.line.xid === "R:0")!;
    expect(ramp).toMatchObject({ lanes: 1, limit: 40, limitKind: "sign" });
  });

  it("takes each chunk's posted limit (maxspeed), and the statutory 60 km/h where the chunk has none", () => {
    const untagged = chunks.map((c) => (c.id === "A:1" ? { ...c, maxspeed: null } : c));
    const graph = graphOf(expresswayRoadInput(untagged, runs, ellipsoidal));
    const a0 = graph.segments.find((s) => s.line.xid === "A:0")!;
    const a1 = graph.segments.filter((s) => s.line.xid === "A:1");
    expect(a0).toMatchObject({ limit: 50, limitKind: "sign" });
    expect(speedLimit(a0)).toBe(50);
    for (const seg of a1) {
      expect(seg).toMatchObject({ limit: null, limitKind: "statutory" });
      expect(speedLimit(seg)).toBe(60);
    }
  });

  it("joins the chunks of a run at their seam and the ramp to the main line where it ends on it", () => {
    const graph = graphOf(input);
    const a = graph.segments.filter((s) => s.line.xid?.startsWith("A:"));
    const ramp = graph.segments.find((s) => s.line.xid === "R:0")!;
    // A:1 is split at s = 300 (100 m into it) where the ramp ends.
    expect(a.map((s) => Math.round(s.length))).toEqual([200, 100, 100]);
    const [, firstHalf, secondHalf] = a;
    expect(a[0].to).toBe(firstHalf.from);
    expect(ramp.to).toBe(firstHalf.to);
    expect(graph.exits(ramp.to, ramp.id)).toEqual([secondHalf]);
    // The junction point is on A's surface: the ramp arrives at A's height there.
    expect(graph.surfaceY(ramp, ramp.length)).toBeCloseTo(graph.surfaceY(firstHalf, firstHalf.length)!, 6);
  });

  it("joins a ramp's ground end to the street within 15 m, and reports one with none", () => {
    // A street running north on x = 140 (10 m west of the ramp's foot at x = 150).
    const street = (x: number): RoadLine => ({
      coords: [...plane.toLonLat(x, -200), ...plane.toLonLat(x, 0)],
      width: 9,
      oneway: 0,
      kind: "local",
    });
    const reports: RoadDiagnostic[] = [];
    const graph = graphOf(input, [street(140), ...area], reports);
    expect(reports).toEqual([]);
    const ramp = graph.segments.find((s) => s.line.xid === "R:0")!;
    const atFoot = (graph.nodes.get(ramp.from) ?? []).map((id) => graph.segments[id]);
    const connector = atFoot.find((s) => s !== ramp)!;
    expect(connector.line).toMatchObject({ source: "osm", structure: "ground", level: 0 });
    // The connector arrives on the street, which is split there into two halves.
    const streets = (graph.nodes.get(connector.from) ?? []).map((id) => graph.segments[id]);
    expect(streets.filter((s) => s.line.kind === "local")).toHaveLength(2);
    const far: RoadDiagnostic[] = [];
    graphOf(input, [street(120), ...area], far);
    expect(far).toEqual([{ event: "ramp_unattached", fields: { run: "R", end: "start", reachM: 15 } }]);
  });

  it("neither joins nor reports a ramp end outside the loaded streets (the next area joins it)", () => {
    const reports: RoadDiagnostic[] = [];
    // Only a street 2 km away is loaded: the ramp's foot is outside the streets' extent.
    const lines = joinExpressway(
      [
        {
          coords: [...plane.toLonLat(2000, 0), ...plane.toLonLat(2600, 600)],
          width: 9,
          oneway: 0,
          kind: "local",
        },
      ],
      input,
      (d) => reports.push(d),
    );
    expect(reports).toEqual([]);
    expect(lines.filter((l) => l.source === "osm" && !l.xid)).toEqual([]);
  });

  it("follows GSI's at-grade 高速道路 line from the ramp's foot to the street, and drops it", () => {
    // GSI's at-grade part of the ramp: from under its foot on ahead, then 60 m west to a street
    // corner (S6 PR 7c1, F1: the ramp's own line passes within its half width of the lead point).
    const corner = plane.toLonLat(90, -45);
    const atGrade: RoadLine = {
      coords: [
        ...plane.toLonLat(152, -39.5),
        ...plane.toLonLat(140, -42.7),
        ...plane.toLonLat(120, -45),
        ...corner,
      ],
      width: 4.3,
      oneway: 0,
      kind: "highway",
    };
    const street: RoadLine = {
      coords: [...plane.toLonLat(90, -200), ...corner, ...plane.toLonLat(90, 100)],
      width: 9,
      oneway: 0,
      kind: "local",
    };
    const reports: RoadDiagnostic[] = [];
    const lines = joinExpressway([atGrade, street, ...area], input, (d) => reports.push(d));
    expect(reports).toEqual([]);
    expect(lines).not.toContain(atGrade);
    const graph = new RoadGraph(lines, frame);
    const ramp = graph.segments.find((s) => s.line.xid === "R:0")!;
    const connector = (graph.nodes.get(ramp.from) ?? [])
      .map((id) => graph.segments[id])
      .find((s) => s !== ramp)!;
    expect(connector.length).toBeGreaterThan(55);
    const atCorner = (graph.nodes.get(connector.from) ?? []).map((id) => graph.segments[id].line.kind);
    expect(atCorner.filter((k) => k === "local")).toHaveLength(2);
  });
});

describe("層つき検索 on the decks: the car on the deck finds the deck, under it the street", () => {
  const { chunks, runs } = section();
  // A street right under A from west to east (the deck is 9–12 m over it).
  const under: RoadLine = {
    coords: [...plane.toLonLat(-50, 0), ...plane.toLonLat(450, 0)],
    width: 12,
    oneway: 0,
    kind: "national",
  };
  const graph = graphOf(expresswayRoadInput(chunks, runs, ellipsoidal), [under]);
  graph.ground = () => frame.toLocal(35.65, 139.751, 3 + N).y;

  it("answers the deck for a car on it and the street for a car under it, by locate and nearestOnSurface", () => {
    const a0 = graph.segments.find((s) => s.line.xid === "A:0")!;
    const { pos } = graph.sample(a0, 120);
    const deckY = graph.surfaceY(a0, 120)!;
    const onDeck = pos.clone().setY(deckY + 0.86);
    expect(graph.locate(onDeck, 30)?.seg).toBe(a0);
    expect(graph.nearestOnSurface(onDeck, 30)?.seg).toBe(a0);
    const below = pos.clone().setY(graph.ground(pos.x, pos.z)! + 0.86);
    expect(graph.locate(below, 30)?.seg.line.kind).toBe("national");
    expect(graph.nearestOnSurface(below, 30)?.seg.line.kind).toBe("national");
  });
});

// Synthetic 分流 for the merge (P3.5): a main line M curving left on a circle of radius 400 m over a
// crest, in two chunks with stations every 12 m, and a one-lane ramp C that leaves M's centreline at
// s = 60 and drifts left at 0.12 m per metre, 3 cm above M's surface, with stations every 10 m (its
// rings never line up with M's).
const RM = 400;
const zM = (s: number) => 10 + 0.02 * s - (s * s) / 6000;
const gM = (s: number) => 0.02 - s / 3000;
const mAt = (s: number): [number, number] => [RM * Math.sin(s / RM), RM - RM * Math.cos(s / RM)];
const wOf = (sM: number) => Math.max(0, sM - 60) * 0.12;
const RAMP_DZ = 0.03;
/** C's plan point at M's distance sM (M's point moved left by w). */
const cPlan = (sM: number): [number, number] => {
  const [x, y] = mAt(sM);
  const th = sM / RM;
  return [x - Math.sin(th) * wOf(sM), y + Math.cos(th) * wOf(sM)];
};
/** sM at each 0.05 m of sM from 60 to 220, with C's arc length there. */
const cTable = (() => {
  const sMs: number[] = [60];
  const sCs: number[] = [0];
  for (let sM = 60.05; sM <= 220 + 1e-9; sM += 0.05) {
    const [ax, ay] = cPlan(sM - 0.05);
    const [bx, by] = cPlan(sM);
    sMs.push(sM);
    sCs.push(sCs[sCs.length - 1] + Math.hypot(bx - ax, by - ay));
  }
  return { sMs, sCs };
})();
const sMOf = (sC: number) => {
  const { sMs, sCs } = cTable;
  let i = 0;
  while (i < sCs.length - 2 && sCs[i + 1] < sC) i++;
  const t = (sC - sCs[i]) / (sCs[i + 1] - sCs[i]);
  return sMs[i] + (sMs[i + 1] - sMs[i]) * t;
};
const sCOf = (sM: number) => {
  const { sMs, sCs } = cTable;
  const i = Math.min(sMs.length - 2, Math.max(0, Math.floor((sM - 60) / 0.05)));
  return sCs[i] + ((sCs[i + 1] - sCs[i]) * (sM - sMs[i])) / (sMs[i + 1] - sMs[i]);
};

/**
 * The 分流 above; `rise` moves C off M's surface by its extra height and grade at C's distance (0 for
 * the one slab of P3.5).
 */
function diverge(rise: (sC: number) => [number, number] = () => [0, 0]): {
  chunks: XwChunk[];
  runs: XwRunSummary[];
  m: XwChunk[];
  c: XwChunk;
} {
  const mChunk = (id: string, s0: number, s1: number) => {
    const ch = chunkOf(id, "M", s0, s1, 12, (s) => [...mAt(s), zM(s), gM(s)]);
    ch.h0 = s0 / RM;
    ch.h1 = s1 / RM;
    ch.g0 = gM(s0);
    ch.g1 = gM(s1);
    return ch;
  };
  const m0 = mChunk("M:0", 0, 120);
  const m1 = mChunk("M:1", 120, 300);
  m0.next = "M:1";
  m1.prev = "M:0";
  const lenC = cTable.sCs[cTable.sCs.length - 1];
  const at = (sC: number): [number, number, number, number] => {
    const sM = sMOf(Math.min(lenC, sC));
    const dsM = sMOf(Math.min(lenC, sC + 0.05)) - sMOf(Math.max(0, sC - 0.05));
    const dsC = Math.min(lenC, sC + 0.05) - Math.max(0, sC - 0.05);
    const [dz, dg] = rise(sC);
    return [...cPlan(sM), zM(sM) + RAMP_DZ + dz, (gM(sM) * dsM) / dsC + dg];
  };
  const c = chunkOf("C:0", "C", 0, Math.floor(lenC / 10) * 10, 10, at);
  c.cls = "ramp";
  c.lanes = 1;
  c.shoulderL = 1;
  c.shoulderR = 0.5;
  const heading = (sM: number) => {
    const [ax, ay] = cPlan(sM);
    const [bx, by] = cPlan(sM + 0.05);
    return Math.atan2(by - ay, bx - ax);
  };
  const lastS = c.st[c.st.length - 7];
  c.h0 = heading(60);
  c.h1 = heading(sMOf(lastS));
  // The compiler's stretch: from the nose to where the carriageways (plus 0.5 m) part.
  const apart = 60 + (4.25 + 2.375 + 0.5) / 0.12;
  m0.decks = [{ with: "C", relation: "same", s0: 60, s1: Math.min(120, apart) }];
  c.decks = [{ with: "M", relation: "same", s0: 0, s1: sCOf(apart) }];
  const summary = (id: string, cls: "expressway" | "ramp", chunks: string[], start: object) =>
    ({
      id,
      chain: id,
      cls,
      ref: null,
      lengthM: 0,
      V: 60,
      tagV: cls === "ramp" ? 40 : 60,
      planV: 60,
      minRadiusM: 0,
      maxShiftM: 0,
      steps: [],
      start,
      end: { kind: "ground" },
      chunks,
      structure: null,
    }) as XwRunSummary;
  return {
    chunks: [m0, m1, c],
    m: [m0, m1],
    c,
    runs: [
      summary("M", "expressway", ["M:0", "M:1"], { kind: "open" }),
      summary("C", "ramp", ["C:0"], { kind: "junction", parent: "M", parentS: 60 }),
    ],
  };
}

function indexOf(chunks: XwChunk[], runs: XwRunSummary[]): DeckIndex {
  const index = new DeckIndex(new Map(runs.map((r) => [r.id, r])));
  for (const c of chunks) index.add(c);
  return index;
}

/** Bodies of chunks built with a context (the merged decks). */
function mergedWorld(chunks: XwChunk[], index: DeckIndex) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  worlds.push(world);
  const out = new Map<string, ReturnType<typeof built>>();
  for (const c of chunks) {
    const b = built(c, frame, { index });
    out.set(c.id, b);
    createDeckBody(world, b.collider, b.piers, null);
  }
  world.step();
  return { world, built: out };
}

/** M's centre line in the local frame from its own rings, as (point, left, s) at a share along. */
function mFrames(m: XwChunk[]) {
  const rings = m.flatMap((c, i) => chunkRings(c, place(frame)).rings.slice(i === 0 ? 0 : 1));
  return (s: number) => {
    let k = 0;
    while (k < rings.length - 2 && rings[k + 1].frame.s <= s) k++;
    const a = rings[k];
    const b = rings[k + 1];
    const t = (s - a.frame.s) / (b.frame.s - a.frame.s);
    const c = a.c.clone().lerp(b.c, t);
    const tan = a.t.clone().lerp(b.t, t).normalize();
    return { c, left: new Vector3(tan.z, 0, -tan.x), tangent: tan };
  };
}

describe("one slab where two decks share a surface (P3.5, expresswayMerge.ts)", () => {
  const { chunks, runs, m, c } = diverge();
  const index = indexOf(chunks, runs);
  const edgeM = sectionWidth(m[0]) / 2 + PARAPET_WIDTH.value;
  const hwM = sectionWidth(m[0]) / 2;
  const mAtS = mFrames(m);
  const isAsphalt = (col: Float32Array, i: number) =>
    Math.abs(col[i] - 0.16) < 1e-6 && Math.abs(col[i + 2] - 0.17) < 1e-6;
  /** Offset of a local point left of M's centre line (nearest of M's s, by a fine search). */
  const offsetFromM = (p: Vector3) => {
    let best = { d: Infinity, s: 0 };
    for (let s = 0; s <= 300; s += 0.25) {
      const d = Math.abs(p.clone().sub(mAtS(s).c).dot(mAtS(s).tangent));
      if (d < best.d) best = { d, s };
    }
    // Then onto the foot (the step along the tangent), so the height and offset are at it.
    const s = Math.min(300, Math.max(0, best.s + p.clone().sub(mAtS(best.s).c).dot(mAtS(best.s).tangent)));
    const f = mAtS(s);
    return { u: p.clone().sub(f.c).dot(f.left), s };
  };

  it("draws no road of the ramp over the main line's slab: its road ends on M's edge or lies under M's face", () => {
    const b = built(c, frame, { index });
    const P = b.arrays.position;
    let onEdge = 0;
    let tucked = 0;
    let outside = 0;
    for (let i = 0; i < P.length; i += 3) {
      if (!isAsphalt(b.arrays.color, i)) continue;
      const p = new Vector3(P[i], P[i + 1], P[i + 2]);
      const { u, s } = offsetFromM(p);
      if (u >= edgeM + 0.002) {
        outside++;
        continue;
      }
      const mY = mAtS(s).c.y;
      // On M's edge (the seam, within the curve's 2 mm between the edge polyline and the offset
      // centre line) at M's face, or hidden under it.
      const isSeam = Math.abs(u - edgeM) <= 0.002 && Math.abs(p.y - mY) <= 0.002;
      const isUnder = p.y <= mY - 0.01;
      expect(isSeam || isUnder, `u ${u.toFixed(3)} s ${s} dy ${(p.y - mY).toFixed(3)}`).toBe(true);
      if (isSeam) onEdge++;
      else tucked++;
    }
    expect(onEdge).toBeGreaterThan(10);
    expect(onEdge + tucked + outside).toBeGreaterThan(100);
    expect(outside).toBeGreaterThan(100);
  });

  it("gives the ramp no collider face near M's surface over M's carriageway (the overlap is M's face alone)", () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worlds.push(world);
    const b = built(c, frame, { index });
    createDeckBody(world, b.collider, b.piers, null);
    world.step();
    let checked = 0;
    for (let s = 60.3; s < 140; s += 0.7) {
      const f = mAtS(s);
      for (let u = -hwM + 0.05; u <= hwM - 0.05; u += 0.5) {
        const p = f.c.clone().addScaledVector(f.left, u);
        const hit = down(world, p.x, p.y + 1, p.z);
        const isNearSurface = hit !== null && hit > p.y - 0.01;
        expect(isNearSurface, `s ${s.toFixed(1)} u ${u.toFixed(2)}`).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("meets M's face at the seam with no step over 1 mm, within 1 cm of M's surfaceHeight (T11)", () => {
    const { world } = mergedWorld(chunks, index);
    let checked = 0;
    for (let s = 60.13; s < 140; s += 0.37) {
      const f = mAtS(s);
      const inside = f.c.clone().addScaledVector(f.left, edgeM - 0.005);
      const outside = f.c.clone().addScaledVector(f.left, edgeM + 0.005);
      const yIn = down(world, inside.x, inside.y + 0.5, inside.z);
      const yOut = down(world, outside.x, outside.y + 0.5, outside.z);
      // Beside the seam the ramp is there (its road starts at M's edge) or not yet / no longer.
      const isRampThere = yOut !== null && Math.abs(yOut - outside.y) < 0.2;
      if (!isRampThere || yIn === null) continue;
      expect(Math.abs(yIn - yOut!), `s ${s.toFixed(2)}`).toBeLessThanOrEqual(0.001);
      // The shared contract: M's Hermite surface (profile.ts surfaceHeight, unbanked) at that s.
      const fr = frameAt(m[s < 120 ? 0 : 1].st, s);
      const contract = frame.toLocal(fr.lat, fr.lon, surfaceHeight(fr, edgeM, false) + N).y;
      expect(Math.abs(yOut! - contract), `s ${s.toFixed(2)}`).toBeLessThanOrEqual(0.01);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("leaves no hole in a 0.5 m grid over both carriageways and keeps T11 on both centre lines where visible", () => {
    const { world } = mergedWorld(chunks, index);
    const rampGraph = graphOf(expresswayRoadInput(chunks, runs, ellipsoidal));
    for (const seg of rampGraph.segments.filter((x) => x.line.xid)) {
      const half = sectionWidth(seg.line.section!) / 2;
      for (let s = 0.25; s < seg.length; s += 0.5) {
        const { pos, dir } = rampGraph.sample(seg, s);
        const y = rampGraph.surfaceY(seg, s)!;
        for (let u = -half + 0.1; u <= half - 0.1; u += 0.5) {
          const p = pos.clone().add(leftOf(dir, u));
          expect(down(world, p.x, y + 2, p.z), `${seg.line.xid} s ${s} u ${u}`).not.toBeNull();
        }
        // T11 on the centre where the deck's own road is the top there: M everywhere, C once its
        // centre is past M's slab and the 1 m ramp up from the seam (MERGE_RAMP; under M a car on
        // C's line is on M's face, ≤ 5 cm off C's surfaceY).
        const isVisible = seg.line.xid !== "C:0" || offsetFromM(pos).u > edgeM + MERGE_RAMP + 0.05;
        if (!isVisible) continue;
        const hit = down(world, pos.x, y + 2, pos.z)!;
        expect(Math.abs(hit - y), `${seg.line.xid} s ${s}`).toBeLessThanOrEqual(0.01);
      }
    }
  });

  it("stands the walls on the one slab's outer edge: none between the two, the ramp's own once it leaves M", () => {
    const { built: b } = mergedWorld(chunks, index);
    const at = (id: string, s: number) => {
      const r = b.get(id)!;
      let i = 0;
      while (i < r.rings.length - 1 && r.rings[i].frame.s < s) i++;
      return r.sides[i];
    };
    // C fully inside M near the nose: neither of C's walls, and M keeps its own.
    const nose = at("C:0", 5);
    expect([nose.left.wall, nose.right.wall]).toEqual([null, null]);
    expect(nose.left.reach + nose.right.reach).toBeLessThanOrEqual(0);
    expect(at("M:0", 66).left.wall).not.toBeNull();
    // C half out (w = 6 m at sM = 110): M drops its left wall and runs its road to its slab edge;
    // C (M on its right) is cut at M's edge with no wall on that side, its left wall stands.
    const mid = at("M:0", 110);
    expect(mid.left.wall).toBeNull();
    expect(mid.left.reach).toBeCloseTo(edgeM, 9);
    const cMid = at("C:0", sCOf(110));
    expect(cMid.right.wall).toBeNull();
    expect(cMid.right.seam).not.toBeNull();
    expect(cMid.left.wall).not.toBeNull();
    // Apart (w = 12 m): both decks have both walls.
    expect(at("M:1", 160).left.wall).not.toBeNull();
    const away = at("C:0", sCOf(160));
    expect(away.left.wall && away.right.wall).toBeTruthy();
  });

  it("joins nothing the compiler did not pair (W7): a deck alongside without a stretch keeps its walls", () => {
    const unpaired = chunks.map((ch) => ({ ...ch, decks: [] }));
    const lone = indexOf(unpaired, runs);
    const b = built(unpaired[2], frame, { index: lone });
    for (const sd of b.sides) {
      expect(sd.left.wall && sd.right.wall).toBeTruthy();
      expect(sd.right.seam).toBeNull();
    }
  });

  it("does not make one slab of a pair farther apart in height than MERGE_MAX_DZ (a level changeover)", () => {
    const { chunks: cs, runs: rs } = diverge();
    const ramp = cs[2];
    for (let i = 0; i < ramp.st.length; i += 7) ramp.st[i + 3] += MERGE_MAX_DZ + 0.05;
    const b = built(ramp, frame, { index: indexOf(cs, rs) });
    expect(b.sides.every((sd) => sd.left.seam === null && sd.right.seam === null)).toBe(true);
  });

  it("keeps the ramp's seam on the main line when three decks meet, whatever the order of decks, and meets the main line where its road ends", () => {
    // B runs the other way 8 m left of M (one slab with M, B's 分離壁 in the middle: "B" sorts
    // first), and C leaves M to the left into that slab: C's master M stops short of its edge there.
    const { runs: rs, m: ms, c: ramp } = diverge();
    const lenB = (300 * (RM - 8)) / RM;
    const b = chunkOf("B:0", "B", 0, lenB, 10, (sB) => {
      const sM = 300 - (sB * RM) / (RM - 8);
      const [x, y] = mAt(sM);
      const th = sM / RM;
      return [x - Math.sin(th) * 8, y + Math.cos(th) * 8, zM(sM), (-gM(sM) * RM) / (RM - 8)];
    });
    b.h0 = Math.PI + 300 / RM;
    b.h1 = Math.PI;
    b.decks = [
      { with: "M", relation: "same", s0: 0, s1: lenB },
      { with: "C", relation: "same", s0: 0, s1: lenB },
    ];
    ms[0].decks = [...ms[0].decks, { with: "B", relation: "same", s0: 0, s1: 120 }];
    ms[1].decks = [{ with: "B", relation: "same", s0: 120, s1: 300 }];
    const forward = [...ramp.decks, { with: "B", relation: "same" as const, s0: 0, s1: 200 }];
    const open = { kind: "open" };
    const all = [
      ...rs,
      { id: "B", cls: "expressway", start: open, end: open, chunks: ["B:0"] } as unknown as XwRunSummary,
    ];
    const sidesWith = (decks: typeof forward) => {
      const c = { ...ramp, decks };
      const index = indexOf([...ms, c, b], all);
      return { c, index, built: built(c, frame, { index }) };
    };
    const one = sidesWith(forward);
    const other = sidesWith(forward.toReversed());
    const key = (r: ReturnType<typeof built>) =>
      r.sides.map((sd) => [
        sd.left.reach.toFixed(4),
        sd.right.reach.toFixed(4),
        !!sd.left.seam,
        !!sd.right.seam,
      ]);
    expect(key(other.built)).toEqual(key(one.built));
    // Where C is half out of M (sM 80–93), its seam is on M's side and at M's road end under B's
    // wall (the middle of M and B's overlap, 4.0 m left of M's centre), not on M's nominal edge.
    let checked = 0;
    one.built.rings.forEach((r, i) => {
      const sM = sMOf(r.frame.s);
      const isHalfOut = sM > 80 && sM < 93;
      if (!isHalfOut) return;
      const seam = one.built.sides[i].right.seam;
      expect(seam, `sC ${r.frame.s.toFixed(1)}`).not.toBeNull();
      const f = mAtS(sM);
      const u = new Vector3(seam!.x, seam!.y, seam!.z).sub(f.c).dot(f.left);
      expect(u, `sC ${r.frame.s.toFixed(1)}`).toBeCloseTo(4.0, 1);
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
  });

  it("makes one slab of two banked decks the same (片勾配: heights compared on the master's tilted face)", () => {
    const { chunks: cs, runs: rs, m: ms, c: ramp } = diverge();
    const BANK = 0.04;
    for (const ch of ms) for (let i = 0; i < ch.st.length; i += 7) ch.st[i + 4] = BANK;
    // C on M's tilted face: its centre w metres left of M's stands BANK·w higher, plus 1 cm.
    for (let i = 0; i < ramp.st.length; i += 7) {
      const sM = sMOf(ramp.st[i]);
      ramp.st[i + 3] = zM(sM) + BANK * wOf(sM) + 0.01;
      ramp.st[i + 4] = BANK;
    }
    const index = indexOf(cs, rs);
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worlds.push(world);
    for (const ch of cs) {
      const steps = deckArraySteps(ch, place(frame), true, { index });
      let r = steps.next();
      while (!r.done) r = steps.next();
      if (ch === ramp) expect(r.value.skipped).toEqual([]);
      createDeckBody(world, r.value.collider, r.value.piers, null);
    }
    world.step();
    let checked = 0;
    for (let s = 80.13; s < 120; s += 0.73) {
      const f = mAtS(s);
      const inside = f.c.clone().addScaledVector(f.left, edgeM - 0.002);
      const outside = f.c.clone().addScaledVector(f.left, edgeM + 0.002);
      const yIn = down(world, inside.x, inside.y + 1, inside.z);
      const yOut = down(world, outside.x, outside.y + 1, outside.z);
      expect(yIn, `s ${s}`).not.toBeNull();
      expect(yOut, `s ${s}`).not.toBeNull();
      expect(Math.abs(yIn! - yOut!), `s ${s.toFixed(2)}`).toBeLessThanOrEqual(0.001);
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });

  it("puts one 分離壁 in the middle of two opposite carriageways' overlap, built by the run that sorts first", () => {
    const east = chunkOf("A:0", "A", 0, 200, 20, (s) => [s, 0, zA(s), gA(s)]);
    const west = chunkOf("B:0", "B", 0, 200, 20, (s) => [200 - s, 8, zA(200 - s), -gA(200 - s)]);
    west.h0 = Math.PI;
    west.h1 = Math.PI;
    east.decks = [{ with: "B", relation: "same", s0: 0, s1: 200 }];
    west.decks = [{ with: "A", relation: "same", s0: 0, s1: 200 }];
    const open = { kind: "open" };
    const rs = ["A", "B"].map(
      (id) =>
        ({ id, cls: "expressway", start: open, end: open, chunks: [`${id}:0`] }) as unknown as XwRunSummary,
    );
    const { world, built: b } = mergedWorld([east, west], indexOf([east, west], rs));
    expect(b.get("A:0")!.sides[5].left.wall).not.toBeNull();
    expect(b.get("B:0")!.sides[5].left.wall).toBeNull();
    // Across at x = 101.3 (off the rings' edges): the road, one wall 1.1 m high, the other road.
    const [lon, lat] = plane.toLonLat(101.3, 0);
    const base = frame.toLocal(lat, lon, zA(101.3) + N);
    const [lon8, lat8] = plane.toLonLat(101.3, 8);
    const across = frame
      .toLocal(lat8, lon8, zA(100) + N)
      .sub(base)
      .normalize();
    const high: number[] = [];
    for (let u = 0.5; u <= 7.5; u += 0.02) {
      const p = base.clone().addScaledVector(across, u);
      const y = down(world, p.x, p.y + 3, p.z);
      expect(y, `u ${u.toFixed(2)}`).not.toBeNull();
      if (y! > p.y + 0.5) high.push(u);
    }
    const runsOfHigh = high.filter((u, i) => i === 0 || u - high[i - 1] > 0.03).length;
    expect(runsOfHigh).toBe(1);
    expect((high[0] + high[high.length - 1]) / 2).toBeCloseTo(4, 1);
    expect(high[high.length - 1] - high[0]).toBeCloseTo(PARAPET_WIDTH.value, 1);
  });
});

/**
 * Points of a merged chunk's visible road (between −right.reach and left.reach of two consecutive
 * rings, at τ ¼ ½ ¾, every 0.25 m, 0.25 m in from both ends) that no triangle of its own collider
 * covers within 0.3 m of the centre's height. The visible road comes from the builder's sides; the
 * cover from the collider's triangles alone (Rapier is not asked, so a ray along an edge cannot slip).
 */
function roadMisses(chunk: XwChunk, f: LocalFrame, index: DeckIndex): Array<{ s: number; u: number }> {
  const { rings, sides, collider } = built(chunk, f, { index });
  const P = collider.position;
  const covers = (X: number, Z: number, y0: number) => {
    for (let i = 0; i < P.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = P.subarray(i, i + 9);
      const isOutside =
        X < Math.min(ax, bx, cx) ||
        X > Math.max(ax, bx, cx) ||
        Z < Math.min(az, bz, cz) ||
        Z > Math.max(az, bz, cz);
      if (isOutside) continue;
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const l1 = ((bz - cz) * (X - cx) + (cx - bx) * (Z - cz)) / d;
      const l2 = ((cz - az) * (X - cx) + (ax - cx) * (Z - cz)) / d;
      const l3 = 1 - l1 - l2;
      const isIn = l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6;
      if (isIn && Math.abs(l1 * ay + l2 * by + l3 * cy - y0) <= 0.3) return true;
    }
    return false;
  };
  const out: Array<{ s: number; u: number }> = [];
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    const isTiny = Math.hypot(b.c.x - a.c.x, b.c.z - a.c.z) < 0.2;
    if (isTiny) continue;
    for (const tau of [0.25, 0.5, 0.75]) {
      const lo = -(sides[i].right.reach * (1 - tau) + sides[i + 1].right.reach * tau);
      const hi = sides[i].left.reach * (1 - tau) + sides[i + 1].left.reach * tau;
      const c = a.c.clone().lerp(b.c, tau);
      const t = a.t.clone().lerp(b.t, tau).normalize();
      for (let u = lo + 0.25; u <= hi - 0.25; u += 0.25) {
        const isCovered = covers(c.x + t.z * u, c.z - t.x * u, c.y);
        if (!isCovered) out.push({ s: a.frame.s + (b.frame.s - a.frame.s) * tau, u });
      }
    }
  }
  return out;
}

describe("the visible road of a merged deck has a collider face everywhere (review of PR 5, C1)", () => {
  // Before the fix a ring whose road was a metre wide could be taken for a sliver (the share of the
  // climb rounded to 0.9999…): its road ended at the climb's end and the rest became the strip face
  // beside it, drawn concrete and with no collider (145 points of the default data, 2,686 of ship).
  it("covers the 分流's road (C at 3 cm and leaving M's height) with C's own collider", () => {
    for (const net of [
      diverge(),
      diverge((sC) => (sC < 30 ? [0.06, 0] : [0.06 - 0.018 * (sC - 30), -0.018])),
    ]) {
      const index = indexOf(net.chunks, net.runs);
      expect(roadMisses(net.c, frame, index)).toEqual([]);
    }
  });

  it("covers every merged chunk's road of the generated data", () => {
    const g = readExpresswayFiles();
    const index = new DeckIndex(new Map(g.runs.map((r) => [r.id, r])));
    for (const c of g.chunks) index.add(c);
    const frames = framesOf(g.tiles, g.meta.zoom);
    const misses: string[] = [];
    for (const c of g.chunks) {
      const isBore = c.structure === "tunnel" || c.structure === "cut";
      const isMerged = c.decks.some((d) => d.relation === "same");
      if (isBore || !isMerged) continue;
      const m = Math.floor(c.st.length / 14) * 7;
      const near = frames.reduce((best, a) =>
        Math.hypot(c.st[m + 1] - a.lon, c.st[m + 2] - a.lat) <
        Math.hypot(c.st[m + 1] - best.lon, c.st[m + 2] - best.lat)
          ? a
          : best,
      );
      const miss = roadMisses(c, new LocalFrame(near.lat, near.lon, 40), index);
      if (miss.length > 0) misses.push(`${c.id} ×${miss.length} s ${miss[0].s.toFixed(1)}`);
    }
    expect(misses).toEqual([]);
  }, 120_000);

  it("ends a sliver of road (< MERGE_RAMP) by its 壁高欄 below its own surface, within the wall's skirt", () => {
    // C at 4.5 cm above M comes out from under M's edge: its road is first a sliver between the
    // seam and its own wall. The sliver keeps a full ramp's slope from the seam, so its end lies
    // below C's surface by less than the skirt the wall's inner face reaches down to.
    const net = diverge(() => [0.015, 0]);
    const index = indexOf(net.chunks, net.runs);
    const { rings, sides } = built(net.c, frame, { index });
    const { world } = mergedWorld([net.c], index);
    let checked = 0;
    rings.forEach((r, i) => {
      const sd = sides[i];
      const width = sd.left.reach + sd.right.reach;
      const isSliver = sd.right.seam !== null && sd.left.wall !== null && width > 0.05 && width < MERGE_RAMP;
      if (!isSliver) return;
      // 1 cm in from the road's end, beside the wall.
      const u = sd.left.reach - 0.01;
      const y = down(world, r.c.x + r.t.z * u, r.c.y + 0.05, r.c.z - r.t.x * u);
      const at = `s ${r.frame.s.toFixed(2)} width ${width.toFixed(3)}`;
      expect(y, at).not.toBeNull();
      // Short of C's surface by at least half of what a full ramp from the seam (4.5 cm below)
      // still has to climb there; a climb across the sliver would end within millimetres of it.
      const remaining = (RAMP_DZ + 0.015) * (1 - width / MERGE_RAMP);
      expect(y!, at).toBeLessThan(r.c.y - remaining / 2);
      expect(y!, at).toBeGreaterThan(r.c.y - MERGE_SKIRT);
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
  });
});

describe("a seam sliding off the master's face inside one ring interval (S6 PR 5, the let-go point's neighbours)", () => {
  // C stands 9 cm above M up to sC 30 (its road reaches past M's edge from sC ≈ 24), then leaves M's
  // height by 1.8 cm per metre: through M's level at sC 35 and 15 cm below it at sC 43.3, where the
  // pair lets go. C's stations are 10 m apart, so the stretch at M's face (sC 32.2–37.8), both slides
  // and the let-go point lie inside the intervals 30–40 and 40–50, where the deck builder has no
  // ring of its own. Probed as the ledger probes the generated data (scripts/expresswaySeams.ts:
  // stations and the Hermite surfaces, rays into the merged decks).
  const rise = (sC: number): [number, number] => (sC < 30 ? [0.06, 0] : [0.06 - 0.018 * (sC - 30), -0.018]);
  const net = diverge(rise);
  // The frame the other tests build in (its origin).
  const frames = [{ lat: 35.65, lon: 139.751 }];
  const probe = () => {
    const out = probeGenerated(net.chunks, net.runs as never, frames);
    worlds.push(...out.worlds);
    return out;
  };

  it("meets M's face within 1 mm wherever the data has the pair within 5 cm, and slides within MERGE_MAX_DZ elsewhere", () => {
    const { seams, cuts } = probe();
    const atFace = seams.filter((p) => Math.abs(p.dz) <= MERGE_FULL_DZ);
    const sliding = seams.filter((p) => Math.abs(p.dz) > MERGE_FULL_DZ);
    // Both kinds are probed: the stretch at the face and the slides on either side of it.
    expect(atFace.length).toBeGreaterThan(8);
    expect(sliding.length).toBeGreaterThan(8);
    const off = seamCases(seams, cuts, [], { fullDz: MERGE_FULL_DZ, maxDz: MERGE_MAX_DZ }).filter(
      (c) => c.kind === "seam_step" || c.kind === "seam_hole",
    );
    expect(off.map((c) => `${c.key} ${JSON.stringify(c.measured)}`)).toEqual([]);
  });

  it("lets go with no step along travel (LET_GO_MAX_STEP_M) inside the interval", () => {
    const { cuts } = probe();
    expect(cuts.length).toBe(1);
    expect(cuts[0].s).toBeGreaterThan(40);
    expect(cuts[0].s).toBeLessThan(50);
    expect(cuts[0].alongStep).not.toBeNull();
    expect(cuts[0].alongStep!).toBeLessThanOrEqual(LET_GO_MAX_STEP_M);
  });
});

describe("markings where decks meet (expresswayMarkings.ts)", () => {
  const { chunks } = section();
  const open = (half: number): DeckSide => ({
    joined: null,
    otherLaneEdge: null,
    reach: half,
    wall: { inner: half, outer: half + PARAPET_WIDTH.value },
    seam: null,
    seamOf: null,
    seamWeight: 1,
  });

  it("paints edge, lane, branch lines and the 導流帯 within 標識令 別表第四's dimensions", () => {
    const half = sectionWidth(chunks[0]) / 2;
    const ring = (s: number, left: Partial<DeckSide>): { s: number; sides: RingSides } => ({
      s,
      sides: { left: { ...open(half), ...left }, right: open(half) },
    });
    // A main line's left side: joined by a ramp whose lanes meet ours from s 40, apart before.
    const parent = planDeckMarkings(chunks[0], [
      ring(0, {}),
      ring(20, { wall: null, reach: half + 0.5, joined: "parent", otherLaneEdge: 6 }),
      ring(40, { wall: null, reach: half + 0.5, joined: "parent", otherLaneEdge: 3 }),
      ring(60, { wall: null, reach: half + 0.5, joined: "parent", otherLaneEdge: 1 }),
    ]);
    const lane = parent.lines.filter((l) => l.kind === "lane");
    expect(lane).toHaveLength(1);
    // laneLeftEdge − 1 · laneWidth: 4.25 − 1.25 − 3.25.
    expect(lane[0].offset).toBeCloseTo(-0.25, 9);
    const dims = MARKING_DIMENSIONS.value;
    expect(lane[0].width).toBeGreaterThanOrEqual(dims.laneLine.width[0]);
    expect(lane[0].width).toBeLessThanOrEqual(dims.laneLine.width[1]);
    const dash = lane[0].dash!;
    expect(dash.length).toBeGreaterThanOrEqual(dims.laneLine.dash[0]);
    expect(dash.length).toBeLessThanOrEqual(dims.laneLine.dash[1]);
    expect(dash.gap / dash.length).toBeGreaterThanOrEqual(dims.laneLine.gapRatio[0]);
    expect(dash.gap / dash.length).toBeLessThanOrEqual(dims.laneLine.gapRatio[1]);
    for (const edge of parent.lines.filter((l) => l.kind === "edge")) {
      expect(edge.width).toBeGreaterThanOrEqual(dims.edgeLine.width[0]);
      expect(edge.width).toBeLessThanOrEqual(dims.edgeLine.width[1]);
    }
    const branch = parent.lines.find((l) => l.kind === "branch")!;
    expect(branch.offset).toBeCloseTo(3, 9);
    expect(branch.from).toBeCloseTo(30, 9);
    expect(branch.width).toBeGreaterThanOrEqual(dims.speedChangeEdge.width[0]);
    expect(branch.width).toBeLessThanOrEqual(dims.speedChangeEdge.width[1]);
    expect(branch.dash!.length).toBeGreaterThanOrEqual(dims.speedChangeEdge.dash[0]);
    expect(branch.dash!.length).toBeLessThanOrEqual(dims.speedChangeEdge.dash[1]);
    expect(branch.dash!.gap / branch.dash!.length).toBeGreaterThanOrEqual(dims.speedChangeEdge.gapRatio[0]);
    expect(branch.dash!.gap / branch.dash!.length).toBeLessThanOrEqual(dims.speedChangeEdge.gapRatio[1]);
    // The ramp's side, cut at the main line's edge 0.3 m past its road: a 導流帯 where the lanes are
    // apart, from its lane edge over the seam to the main line's lane edge; no edge line where they meet.
    const rampHalf = sectionWidth(chunks[2]) / 2;
    const seam = { x: 0, y: 0, z: 0 };
    const cut = (s: number, other: number) => ({
      s,
      sides: {
        left: {
          ...open(rampHalf),
          wall: null,
          reach: rampHalf - 0.3,
          seam,
          joined: "child" as const,
          otherLaneEdge: other,
        },
        right: open(rampHalf),
      },
    });
    const child = planDeckMarkings(chunks[2], [cut(0, 4), cut(10, 3), cut(20, 1)]);
    expect(child.zebras).toHaveLength(1);
    const z = child.zebras[0];
    expect(z.inner[0]).toBeCloseTo(rampHalf - 1, 9);
    expect(z.outer[0]).toBeCloseTo(4, 9);
    const leftEdges = child.lines.filter((l) => l.kind === "edge" && l.offset > 0);
    expect(leftEdges).toEqual([]);
    // Where its lane runs inside the main line's, the ramp paints nothing (not its far edge either).
    const rightEdge = child.lines.find((l) => l.kind === "edge" && l.offset < 0)!;
    expect(rightEdge.to).toBeCloseTo(15, 9);
  });

  it("stops a cut deck's lines where they would leave its own road (the master's lines are on its face)", () => {
    const half = sectionWidth(chunks[0]) / 2;
    // A two-lane deck cut on its left: its road ends 1 m left of the centre from s 20 to s 40, so
    // its left edge line (3 m left) and its lane line (0.25 m right) are on and off accordingly.
    const ring = (s: number, reach: number) => ({
      s,
      sides: { left: { ...open(half), wall: null, reach, seam: { x: 0, y: 0, z: 0 } }, right: open(half) },
    });
    const plan = planDeckMarkings(chunks[0], [ring(0, half), ring(20, 1), ring(40, -0.5), ring(60, half)]);
    const leftEdge = plan.lines.filter((l) => l.kind === "edge" && l.offset > 0);
    expect(leftEdge.map((l) => [l.from, l.to])).toEqual([
      [0, 10],
      [50, 60],
    ]);
    const lane = plan.lines.filter((l) => l.kind === "lane");
    expect(lane.map((l) => [l.from, l.to])).toEqual([
      [0, 30],
      [50, 60],
    ]);
  });
});

describe("generations: a stale network never replaces the current one (P3 adds the chunks to the request)", () => {
  class WorkerStub extends EventTarget {
    readonly sent: RoadNetworkRequest[] = [];
    postMessage(request: RoadNetworkRequest): void {
      this.sent.push(structuredClone(request));
    }
    terminate(): void {}
    reply(index: number): void {
      const request = this.sent[index];
      this.dispatchEvent(
        new MessageEvent("message", {
          data: structuredClone({ id: request.id, data: computeRoadNetwork(request.input) }),
        }),
      );
    }
  }
  const { chunks, runs } = section();
  const input = expresswayRoadInput(chunks, runs, ellipsoidal);

  it("drops the network built from older chunks and installs the latest", async () => {
    const worker = new WorkerStub();
    const builder = new RoadNetworkBuilder({ createWorker: () => worker as unknown as Worker });
    try {
      const old = builder.build([], null, frame, { lines: input.lines.slice(0, 1), ends: [] });
      const latest = builder.build([], null, frame, input);
      expect(await old).toBeNull();
      worker.reply(0);
      worker.reply(1);
      const network = await latest;
      expect(network!.graph.segments.filter((s) => s.line.xid).map((s) => s.line.xid)).toContain("R:0");
    } finally {
      builder.dispose();
    }
  });

  it("sends no expressway key without ?expressway, so the street network is as before P3", () => {
    const worker = new WorkerStub();
    const builder = new RoadNetworkBuilder({ createWorker: () => worker as unknown as Worker });
    try {
      const street: RoadLine = {
        coords: [...plane.toLonLat(0, 0), ...plane.toLonLat(100, 0)],
        width: 9,
        oneway: 0,
        kind: "local",
      };
      void builder.build([street], null, frame);
      expect(Object.keys(worker.sent[0].input)).toEqual(["lines", "regs", "origin"]);
      const without = computeRoadNetwork({ lines: [street], regs: null, origin: frame.origin });
      const empty = computeRoadNetwork({
        lines: [street],
        regs: null,
        origin: frame.origin,
        expressway: { lines: [], ends: [] },
      });
      expect({ ...empty, computeMs: 0 }).toEqual({ ...without, computeMs: 0 });
      expect(restoreRoadNetwork(without, frame).graph.segments[0].elev).toBeUndefined();
    } finally {
      builder.dispose();
    }
  });
});

describe("heights through the worker: elev is the deck's ring height in the network's frame", () => {
  const { chunks, runs } = section();
  it("puts each point of a chunk's segment at frame.toLocal of its ellipsoidal height", () => {
    const input = expresswayRoadInput(chunks, runs, ellipsoidal);
    const data = computeRoadNetwork({ lines: [], regs: null, origin: frame.origin, expressway: input });
    const graph = restoreRoadNetwork(structuredClone(data), frame).graph;
    const deck = built(chunks[0]);
    const a0 = graph.segments.find((s) => s.line.xid === "A:0")!;
    // The first station: the deck's centre point and the segment's first point are one point.
    expect(a0.elev![0]).toBeCloseTo(deck.stations[0].y, 9);
    const p = new Vector3(a0.pts[0].x, 0, a0.pts[0].z);
    expect(p.distanceTo(deck.stations[0].clone().setY(0))).toBeLessThan(1e-3);
  });
});

describe("which deck a car is on at a 分合流 (the main line over the ramp lying on it)", () => {
  const { chunks, runs } = section();
  const graph = graphOf(expresswayRoadInput(chunks, runs, ellipsoidal));
  const ramp = graph.segments.find((s) => s.line.xid === "R:0")!;

  it("answers the main line for a car in its lanes where the ramp's deck lies on it", () => {
    // In the last 15 m before the junction the ramp's centre is within 4 m of A's: a car in either
    // of A's lanes there is inside the ramp's width gate too.
    const a1 = graph.segments.filter((s) => s.line.xid === "A:1")[0];
    for (const s of [85, 92, 98]) {
      const { pos, dir } = graph.sample(a1, s);
      for (const lane of [0, 1]) {
        const p = pos
          .clone()
          .add(leftOf(dir, laneCentreOffset(a1, lane)))
          .setY(graph.surfaceY(a1, s)! + 0.86);
        expect(graph.locate(p, 30)?.seg.line.xid, `s ${s} lane ${lane}`).toBe("A:1");
      }
    }
  });

  it("still answers the ramp for a car on it away from the main line", () => {
    const { pos } = graph.sample(ramp, 40);
    const p = pos.clone().setY(graph.surfaceY(ramp, 40)! + 0.86);
    expect(graph.locate(p, 30)?.seg).toBe(ramp);
  });

  // The main lines only: since XW_VERSION 3 a ramp without maxspeed takes the statutory 60 km/h, more
  // than a main line posted at 50, and on the stretch where its lane lies over the main line's
  // carriageway (the 加速・減速車線) the car is on the main line and takes its limit.
  it("never puts a car at a main line's lane centre of the generated data on a deck with a lower limit than its own", () => {
    const { chunks: real, runs: realRuns } = readExpresswayFiles(DEFAULT_DATA_DIR);
    const g = new RoadGraph(
      joinExpressway([], expresswayRoadInput(real, realRuns, ellipsoidal), () => {}),
      new LocalFrame(35.6537, 139.7508, 40),
    );
    let checked = 0;
    const lower: string[] = [];
    for (const seg of g.segments.filter((s) => s.line.xid && s.line.cls === "expressway")) {
      for (let lane = 0; lane < seg.lanes; lane++) {
        for (let s = 1; s < seg.length; s += 2) {
          const { pos, dir: d } = g.sample(seg, s);
          const p = pos
            .clone()
            .add(leftOf(d, laneCentreOffset(seg, lane)))
            .setY(g.surfaceY(seg, s)! + 0.86);
          const hit = g.locate(p, 30);
          checked++;
          const isLower = hit !== null && speedLimit(hit.seg) < speedLimit(seg);
          if (isLower) lower.push(`${seg.line.xid} lane ${lane} s ${s} → ${hit.seg.line.xid}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(4000);
    expect(lower).toEqual([]);
    // Every lane centre of both ranges (the Rainbow Bridge's tripled the data): a minute, not 5 s.
  }, 120_000);
});

describe("the generated data's merges (P3.5): seams and let-go points probed from the chunks alone", () => {
  // Where to probe comes from the stations and the Hermite surface (scripts/expresswayPairs.ts), not
  // from the deck builder's rings or sides; heights are rays into every merged chunk (each probed in
  // the frame of the nearest tile centre, scripts/expresswaySeams.ts). What is off the rules is the
  // data folder's ledger (P2.7-4): seam_step / seam_hole cases with their cap, let_go by its rule.
  // The folder is the tests' (XW_DATA_DIR, else public/data/expressway).
  const generated = readExpresswayFiles();
  const probed = () =>
    probeGenerated(generated.chunks, generated.runs, framesOf(generated.tiles, generated.meta.zoom));
  const ledgerCases = (kinds: string[]) =>
    new Map(
      (generated.ledger?.cases ?? [])
        .filter((c) => kinds.includes(c.kind) && c.status !== "gone")
        .map((c) => [c.key, c]),
    );

  it("meets the master's face at every seam a car drives over: ≤ 1 mm where the pair is within 5 cm; what is not is a ledger case within its cap", () => {
    const { seams, cuts, worlds: ws } = probed();
    worlds.push(...ws);
    // Every 0.5 m of the ramps' "same" stretches whose road lies past the master's slab edge and
    // within MERGE_MAX_DZ of it: the count the ledger's budget fixes, so a probe that stops finding
    // its seam fails.
    expect(generated.ledger?.budget?.seamProbes).toBe(seams.length);
    const found = seamCases(seams, cuts, [], { fullDz: MERGE_FULL_DZ, maxDz: MERGE_MAX_DZ }).filter(
      (c) => c.kind === "seam_step" || c.kind === "seam_hole",
    );
    const listed = ledgerCases(["seam_step", "seam_hole"]);
    expect(found.map((c) => c.key).sort()).toEqual([...listed.keys()].sort());
    for (const c of found) {
      const entry = listed.get(c.key)!;
      // A sliding band's step is the rule's (S6 PR 7c: no cap); any other is a review's within its cap.
      const isByRule = entry.by === "rule" && isAutoAccepted(c);
      if (isByRule) continue;
      expect(entry.cap, c.key).not.toBeNull();
      expect(withinCap(c.measured, entry.cap!), `${c.key} ${JSON.stringify(c.measured)}`).toBe(true);
    }
    // A world per tile with chunks, each with every chunk near it: tens of seconds on a busy machine.
  }, 120_000);

  it("lets go of a pair with no step along travel (the rule's 1 mm), at the places the ledger lists", () => {
    const { seams, cuts, worlds: ws } = probed();
    worlds.push(...ws);
    // Before P3.5's review these were faces across the road up to 0.15 m high (W1).
    const found = seamCases(seams, cuts, [], { fullDz: MERGE_FULL_DZ, maxDz: MERGE_MAX_DZ }).filter(
      (c) => c.kind === "let_go",
    );
    expect(found.map((c) => c.key).sort()).toEqual([...ledgerCases(["let_go"]).keys()].sort());
    for (const c of cuts) {
      expect(c.alongStep, `${c.chunk} s ${c.s}`).not.toBeNull();
      expect(c.alongStep!, `${c.chunk} s ${c.s}`).toBeLessThanOrEqual(LET_GO_MAX_STEP_M);
    }
  }, 120_000);
});

describe("T11 against the analytic surface (not only the graph's own heights)", () => {
  const { chunks, runs } = section();
  it("puts surfaceY on A's crest z(s) = 12 − (s − 200)² / 2800 within 1 cm in the frame", () => {
    const graph = graphOf(expresswayRoadInput(chunks, runs, ellipsoidal));
    for (const [k0, xid] of [
      [0, "A:0"],
      [1, "A:1"],
    ] as const) {
      const seg = graph.segments.find((s) => s.line.xid === xid)!;
      const s0 = k0 * 200;
      // Up to 99 m: A:1 is split at s = 300 (the ramp's junction); its first piece is checked.
      for (let k = 0.37; k < 99; k += 3.1) {
        const f = frameAt(chunks[k0].st, s0 + k);
        const expected = frame.toLocal(f.lat, f.lon, zA(s0 + k) + N).y;
        const on = graph.nearestOn(seg, frame.toLocal(f.lat, f.lon, 0));
        expect(Math.abs(graph.surfaceY(seg, on.s)! - expected), `${xid} ${k}`).toBeLessThanOrEqual(0.01);
      }
    }
  });
});

describe("markings at the sizes the plan fixes (not read back from the same constants)", () => {
  it("paints the expressway's edge lines 0.20 m and its lane lines 0.15 m wide, dashed 8 m / 12 m", () => {
    const open: DeckSide = {
      joined: null,
      otherLaneEdge: null,
      reach: 4.25,
      wall: { inner: 4.25, outer: 4.75 },
      seam: null,
      seamOf: null,
      seamWeight: 1,
    };
    const plan = planDeckMarkings(section().chunks[0], [
      { s: 0, sides: { left: open, right: open } },
      { s: 100, sides: { left: open, right: open } },
    ]);
    expect(plan.lines.filter((l) => l.kind === "edge").map((l) => l.width)).toEqual([0.2, 0.2]);
    expect(plan.lines.filter((l) => l.kind === "lane").map((l) => [l.width, l.dash])).toEqual([
      [0.15, { length: 8, gap: 12 }],
    ]);
  });
});

describe("collision groups: buildings stay solid for everyone, a car on a deck included (P4 cuts them)", () => {
  it("lets every default collider, ground probe and prop meet a building", () => {
    const meets = (a: number, b: number) =>
      ((a >>> 16) & b & 0xffff) !== 0 && ((b >>> 16) & a & 0xffff) !== 0;
    for (const other of [ALL_GROUPS, GROUND_QUERY_GROUPS, PROP_GROUPS])
      expect(meets(BUILDING_GROUPS, other)).toBe(true);
  });
});

describe("ExpresswayDecks lifecycle (colliders 400 m / 550 m, the hold and the warp's wait)", () => {
  const { chunks, runs } = section();
  const tiles = packTiles(chunks, runs, [], 14);
  const meta: XwMeta = {
    version: XW_VERSION,
    zoom: 14,
    tiles: [...tiles.keys()],
    ranges: [],
    structures: [],
    extract: { url: "", timestamp: null },
    counts: { runs: 2, chunks: 3, stations: 0, piers: 0, crossings: 0 },
    bytes: 0,
  };
  beforeAll(() => {
    vi.stubGlobal("fetch", async (url: string) => {
      const name = String(url).split("/").pop()!.replace(".json", "");
      const body = name === "meta" ? meta : (tiles.get(name) ?? null);
      return { ok: body !== null, json: async () => body };
    });
  });
  afterAll(() => vi.unstubAllGlobals());
  const settle = async (decks: ExpresswayDecks, lat: number, lon: number) => {
    decks.update(lat, lon);
    for (let i = 0; i < 400 && !decks.isSettledAt(lat, lon); i++) await new Promise((r) => setTimeout(r, 5));
  };

  it("builds bodies near the car, finds their surface below a point, drops them far off, and lets a held car go", async () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    worlds.push(world);
    const decks = new ExpresswayDecks(new Scene(), world, ellipsoidal, frame, "/");
    const [lon, lat] = plane.toLonLat(100, 0);
    await settle(decks, lat, lon);
    expect(decks.chunkCount()).toBe(3);
    expect(decks.colliderCount()).toBe(3);
    expect(decks.isReadyNear(lat, lon)).toBe(true);
    world.step();
    // The deck's surface under a point of A, from above it.
    const f = frameAt(chunks[0].st, 100.3);
    const p = frame.toLocal(f.lat, f.lon, f.z + N);
    expect(Math.abs(decks.surfaceBelow(p.x, p.y + 3, p.z)! - p.y)).toBeLessThanOrEqual(0.01);
    // 1.3 km east: every chunk is beyond 550 m, the bodies go (the meshes stay within 1.9 km).
    const [lonFar, latFar] = plane.toLonLat(1300, 0);
    await settle(decks, latFar, lonFar);
    world.step();
    expect(decks.colliderCount()).toBe(0);
    expect(decks.chunkCount()).toBe(3);
    expect(decks.surfaceBelow(p.x, p.y + 3, p.z)).toBeNull();
    // Back at A before a refresh: held, then let go after HOLD_MAX_MS; the warp waits for a refresh.
    const t0 = 1_000_000;
    expect(decks.isReadyNear(lat, lon, t0)).toBe(false);
    expect(decks.isReadyNear(lat, lon, t0 + HOLD_MAX_MS - 1)).toBe(false);
    expect(decks.isReadyNear(lat, lon, t0 + HOLD_MAX_MS + 1)).toBe(true);
    expect(decks.isSettledAt(lat, lon)).toBe(false);
  });
});
