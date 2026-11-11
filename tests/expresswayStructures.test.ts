import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readExpresswayFiles } from "../scripts/expresswayFiles";
import { checkGrade, checkPlan, checkSuperelevation, checkVerticalCurves } from "../src/expressway/checks";
import { majorityClass, planNetwork, solvePlan } from "../src/expressway/compile";
import { STATION_STRIDE, type XwChunk, type XwTile } from "../src/expressway/format";
import { type Network, normalizeNode, normalizeStreetWay, normalizeWay } from "../src/expressway/network";
import { frameAt, surfaceAt } from "../src/expressway/profile";
import { DEFAULT_RANGES, parseRanges, RANGES } from "../src/expressway/ranges";
import { LocalFrame } from "../src/geo/frame";
import { deckArraySteps, SLAB } from "../src/world/expresswayDeck";
import { outranks } from "../src/world/expresswayMerge";
import {
  deckSection,
  fromAxis,
  STRUCTURE_SPECS,
  type Structure,
  structureFrom,
  StructureMismatchError,
  toAxis,
} from "../src/expressway/structures";
import { DeckLevelsSchema, deckHeight, type DeckLevels } from "../src/world/deckLevels";
import { expresswayRoadInput, joinExpressway } from "../src/world/expresswayRoads";
import type { RoadLine } from "../src/world/roads";

// Structure overrides (knowledge/road-redesign-plan.md 4.6, P7): the Rainbow Bridge's deck levels
// from landmarks.json pin the decks the compiler builds over it.
const ROOT = join(import.meta.dirname, "..");
const landmark = (
  JSON.parse(readFileSync(join(ROOT, "public", "data", "landmarks.json"), "utf8")) as Array<{
    id: string;
    deckLevels?: unknown;
  }>
).find((e) => e.id === "rainbow_bridge")!;
const levels: DeckLevels = DeckLevelsSchema.parse(landmark.deckLevels);
const spec = STRUCTURE_SPECS.find((s) => s.landmark === "rainbow_bridge")!;
const bridge: Structure = structureFrom(spec, levels);
const deck = (id: string) => bridge.decks.find((d) => d.id === `rainbow_bridge:${id}`)!;

describe("the decks a structure's strips make (structures.ts deckSection)", () => {
  it("gives the upper floor its lanes, the verge as shoulder, and the 壁高欄 back to back in the median", () => {
    const up = deck("upper:forward");
    expect(up.section).toMatchObject({ lanes: 2, laneWidth: 3.5, shoulderL: 4.8, shoulderR: 1.5 });
    // Band between the parapets' inner faces: 0.5 … 13.8, so its centre is 7.15 (the run's line).
    expect(up.bandOffset).toBeCloseTo(7.15, 6);
    expect(up.stripOffset).toBeCloseTo(5.5, 6);
    expect(up.aprons).toEqual({ left: 0, right: 0 });
    expect(up.cls).toBe("expressway");
    expect(deck("upper:backward").bandOffset).toBeCloseTo(-7.15, 6);
  });

  it("walls the lower road at its fences and leaves the guideway and walkways as drawn aprons only", () => {
    const low = deck("lower:forward");
    expect(low.cls).toBe("street");
    expect(low.section).toMatchObject({ lanes: 2, laneWidth: 3.25, shoulderL: 0.5, shoulderR: 0.5 });
    expect(low.bandOffset).toBeCloseTo(8.15, 6);
    // Left (outside): from the wall's outer face (11.9 + 0.5) to the level's edge 13.8 (the walkway).
    // Right (inside): from 4.4 − 0.5 to the axis, half the guideway (the other road has the rest).
    expect(low.aprons.left).toBeCloseTo(1.4, 6);
    expect(low.aprons.right).toBeCloseTo(3.9, 6);
    const back = deck("lower:backward");
    expect(back.aprons).toEqual(low.aprons);
    expect(back.bandOffset).toBeCloseTo(-8.15, 6);
    expect(
      deckSection(
        levels.levels.lower,
        levels.levels.lower.strips.find((s) => s.direction === "forward")!,
      ).section.lanes,
    ).toBe(2);
  });

  it("maps (s, offset) and lon/lat both ways in true metres, where the levels' flat lon/lat stray by ≤ 2 m", () => {
    // The stations' lon/lat come from flat constants (rainbow_bridge_spec.py), the axis from the origin
    // and bearing the game places the model by: they agree at mid-span and part by under 2 m at the ends.
    for (const st of levels.levels.upper.stations) {
      const a = toAxis(bridge, st.lon, st.lat);
      const allowed = 0.01 + Math.abs(st.s) * 0.004;
      expect(Math.hypot(a.offset, a.s - st.s), `s=${st.s}`).toBeLessThan(allowed);
    }
    const mid = toAxis(bridge, levels.axis.origin[0], levels.axis.origin[1]);
    expect(Math.hypot(mid.offset, mid.s)).toBeLessThan(1e-9);
    const [lon, lat] = fromAxis(bridge, 123.4, -5.6);
    const back = toAxis(bridge, lon, lat);
    expect(back.s).toBeCloseTo(123.4, 6);
    expect(back.offset).toBeCloseTo(-5.6, 6);
  });
});

// A synthetic bridge: the upper floor's forward way and the lower road's, straight along the axis
// from 2 km before mid-span to 2 km after, at ground (T.P. 3 m) at both ends.
const GROUND = 3;
function syntheticNet(upperOffset: number, lowerOffset: number): Network {
  const net: Network = { ways: new Map(), nodes: new Map() };
  const add = (id: number, offset: number, base: number, street: boolean) => {
    const ids: number[] = [];
    for (let k = 0; k <= 80; k++) {
      const s = -2000 + k * 50;
      const [lon, lat] = fromAxis(bridge, s, offset);
      const node = base + k;
      net.nodes.set(node, normalizeNode(node, lon, lat, {}));
      ids.push(node);
    }
    const tags: Record<string, string> = street
      ? { highway: "tertiary", bridge: "yes", layer: "3", lanes: "2", maxspeed: "40" }
      : { highway: "motorway", bridge: "yes", layer: "4", lanes: "2", maxspeed: "60", ref: "11" };
    net.ways.set(id, street ? normalizeStreetWay(id, ids, tags) : normalizeWay(id, ids, tags));
  };
  // The ids the strips name, so the structure pins them.
  add(316305908, upperOffset, 10_000, false);
  add(4848879, lowerOffset, 20_000, true);
  return net;
}

describe("structure overrides in the compiler (設計書 4.6)", () => {
  const net = syntheticNet(5.5 + 1.2, 8.15 - 0.8);
  const plan = planNetwork(net, new Set(), null, [bridge]);
  const result = solvePlan(plan, () => GROUND, []);
  const chunksOf = (run: string) => result.chunks.filter((c) => c.run === run).sort((a, b) => a.k - b.k);

  it("pins both floors to the formula: every station over the structure within 1 cm of deckLevels", () => {
    for (const run of ["316305908", "4848879"]) {
      const level = run === "316305908" ? "upper" : "lower";
      let checked = 0;
      for (const c of chunksOf(run)) {
        for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
          const a = toAxis(bridge, c.st[i + 1], c.st[i + 2]).s;
          const isOn = Math.abs(a) <= levels.axis.sRange[1];
          if (!isOn) continue;
          checked++;
          expect(
            Math.abs(c.st[i + 3] - deckHeight(levels, level, a)),
            `${c.id} at ${a.toFixed(1)}`,
          ).toBeLessThanOrEqual(0.01);
          // Between stations too: the Hermite surface reproduces the parabola there.
          const isLast = i + STATION_STRIDE >= c.st.length;
          if (isLast) continue;
          const mid = (c.st[i] + c.st[i + STATION_STRIDE]) / 2;
          const f = frameAt(c.st, mid);
          const am = toAxis(bridge, f.lon, f.lat).s;
          const isMidOn = Math.abs(am) <= levels.axis.sRange[1];
          if (isMidOn)
            expect(
              Math.abs(f.z - deckHeight(levels, level, am)),
              `${c.id} mid ${am.toFixed(1)}`,
            ).toBeLessThanOrEqual(0.01);
        }
      }
      expect(checked).toBeGreaterThan(30);
      const summary = result.runs.find((r) => r.id === run)!;
      expect(summary.structure!.zM).toBeLessThanOrEqual(0.01);
    }
  });

  it("puts the deck on the band's line over the girder, wherever OSM put the way within 3 m", () => {
    for (const [run, name] of [
      ["316305908", "upper:forward"],
      ["4848879", "lower:forward"],
    ] as const) {
      const d = deck(name);
      for (const c of chunksOf(run)) {
        for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
          const p = toAxis(bridge, c.st[i + 1], c.st[i + 2]);
          const isOnGirder = p.s > levels.axis.girderRange[0] + 1 && p.s < levels.axis.girderRange[1] - 1;
          if (isOnGirder) expect(Math.abs(p.offset - d.bandOffset), `${c.id}`).toBeLessThan(0.015);
        }
      }
      const summary = result.runs.find((r) => r.id === run)!;
      expect(summary.structure!.deck).toBe(d.id);
      expect(summary.structure!.osmM).toBeLessThan(levels.tolerance.horizontal);
    }
  });

  it("stops its own piers and girder where the structure carries the deck, and takes the strips' section there", () => {
    for (const run of ["316305908", "4848879"]) {
      for (const c of chunksOf(run)) {
        // Every pier the run has stands outside the structure's pier-free range.
        for (let i = 0; i < c.piers.length; i += 2) {
          const f = frameAt(c.st, c.piers[i]);
          const at = Math.abs(toAxis(bridge, f.lon, f.lat).s);
          expect(at, `${c.id} pier at ${c.piers[i]}`).toBeGreaterThan(levels.axis.pierFreeRange[1]);
        }
        const mid = Math.floor(c.st.length / (2 * STATION_STRIDE)) * STATION_STRIDE;
        const a = Math.abs(toAxis(bridge, c.st[mid + 1], c.st[mid + 2]).s);
        const isCarried = a < levels.axis.pierFreeRange[1] - 1;
        if (isCarried) {
          expect(c.piers, c.id).toEqual([]);
          expect(c.girder, c.id).toBe(0);
        }
        const isOnGirder = a < levels.axis.girderRange[1] - 1;
        if (isOnGirder) {
          expect(c.over, c.id).not.toBeNull();
          expect(c.laneWidth).toBe(run === "316305908" ? 3.5 : 3.25);
        } else expect(c.over, c.id).toBeNull();
      }
    }
    // Off the structure the lower road stands on piers as usual (the upper floor runs over it the
    // whole way here, and no pier comes down through a carriageway).
    expect(chunksOf("4848879").some((c) => c.piers.length > 0)).toBe(true);
  });

  it("compiles the lower road as a street (第四種: speeds down to 20, bank within 6 %) within the statute", () => {
    const street = result.runs.find((r) => r.id === "4848879")!;
    expect(street.cls).toBe("street");
    expect(street.tagV).toBe(40);
    for (const c of chunksOf("4848879")) {
      expect(c.cls).toBe("street");
      expect(checkGrade(c, street)).toEqual([]);
      expect(checkVerticalCurves(c)).toEqual([]);
      expect(checkSuperelevation(c)).toEqual([]);
      expect(checkPlan(c, street).problems).toEqual([]);
    }
    // Both ends come down to the ground (the GSI streets take over there at run time).
    expect([street.start.kind, street.end.kind]).toEqual(["ground", "ground"]);
  });

  it("fails the build when OSM strays more than 3 m from axis + strip centre over the girder", () => {
    const off = syntheticNet(5.5 + 3.2, 8.15);
    expect(() => planNetwork(off, new Set(), null, [bridge])).toThrow(StructureMismatchError);
    expect(() => planNetwork(off, new Set(), null, [bridge])).toThrow(
      /rainbow_bridge:upper:forward.*3\.2\d m/,
    );
    // The recorded bias is counted within the 3 m, not taken off it: 2.9 m passes.
    expect(() => planNetwork(syntheticNet(5.5 - 2.9, 8.15), new Set(), null, [bridge])).not.toThrow();
  });

  it("builds an ordinary viaduct when there is no structure (deckLevels missing)", () => {
    const plain = solvePlan(planNetwork(net, new Set(), null), () => GROUND, []);
    expect(plain.runs.every((r) => r.structure === null)).toBe(true);
    expect(plain.chunks.every((c) => c.over === null && c.girder > 0)).toBe(true);
  });
});

// The generated data (just make-expressway-data: hamazakibashi,rainbow).
const DIR = join(ROOT, "public", "data", "expressway");
// v6: the runs, diagnostics and entrances come from report.json and the tiles (scripts/expresswayFiles.ts).
const meta = readExpresswayFiles(DIR);
const chunks = meta.chunks;
const byRun = new Map<string, XwChunk[]>();
for (const c of chunks)
  byRun.set(
    c.run,
    [...(byRun.get(c.run) ?? []), c].sort((a, b) => a.k - b.k),
  );

describe("the generated Rainbow Bridge decks", () => {
  const decks = meta.runs.filter((r) => r.structure !== null);

  it("builds the four carriageways of both floors, each within its tolerances", () => {
    expect(meta.meta.structures).toEqual([
      {
        id: "rainbow_bridge",
        version: levels.version,
        decks: bridge.decks.map((d) => d.id),
      },
    ]);
    expect(decks.map((r) => r.structure!.deck).sort()).toEqual(bridge.decks.map((d) => d.id).sort());
    for (const r of decks) {
      const s = r.structure!;
      expect(s.osmM, s.deck).toBeLessThanOrEqual(levels.tolerance.horizontal);
      // Lon/lat are rounded to 1e-7° (≈ 1 cm), z to 1 mm.
      expect(s.planM, s.deck).toBeLessThanOrEqual(0.01);
      expect(s.zM, s.deck).toBeLessThanOrEqual(0.01);
    }
  });

  it("meets deckLevels' formula within 1 cm where each deck crosses every station of the levels", () => {
    for (const r of decks) {
      const level = r.structure!.deck.split(":")[1] as "upper" | "lower";
      const pts = byRun.get(r.id)!.flatMap((c) => {
        const out: Array<{ a: number; s: number; st: number[] }> = [];
        for (let i = 0; i < c.st.length; i += STATION_STRIDE)
          out.push({ a: toAxis(bridge, c.st[i + 1], c.st[i + 2]).s, s: c.st[i], st: c.st });
        return out;
      });
      let checked = 0;
      for (const station of levels.levels[level].stations) {
        const k = pts.findIndex((p, i) => i > 0 && (pts[i - 1].a - station.s) * (p.a - station.s) <= 0);
        if (k < 0) continue;
        const [p, q] = [pts[k - 1], pts[k]];
        const t = (station.s - p.a) / (q.a - p.a || 1);
        const s = p.s + (q.s - p.s) * t;
        const z = surfaceAt(q.st, s).z;
        checked++;
        expect(
          Math.abs(z - deckHeight(levels, level, station.s)),
          `${r.structure!.deck} s=${station.s}`,
        ).toBeLessThanOrEqual(0.01);
      }
      expect(checked).toBeGreaterThanOrEqual(levels.levels[level].stations.length - 2);
    }
  });

  it("raises no pier of its own over the spans and anchorages", () => {
    for (const r of decks) {
      for (const c of byRun.get(r.id)!) {
        for (let i = 0; i < c.piers.length; i += 2) {
          const f = frameAt(c.st, c.piers[i]);
          const a = toAxis(bridge, f.lon, f.lat).s;
          expect(Math.abs(a), `${c.id} pier at ${c.piers[i]}`).toBeGreaterThan(levels.axis.pierFreeRange[1]);
        }
      }
    }
  });

  it("joins the lower road to the ground at both ends and the 台場 exit onto it", () => {
    const streets = meta.runs.filter((r) => r.cls === "street");
    expect(streets.map((r) => r.structure?.deck).sort()).toEqual([
      "rainbow_bridge:lower:backward",
      "rainbow_bridge:lower:forward",
    ]);
    for (const r of streets) expect([r.start.kind, r.end.kind]).toEqual(["ground", "ground"]);
    // 台場出口 (4848889) ends on the 臨港道路's 台場 approach (OSM: 820214407 → 333682057).
    const exit = meta.runs.find((r) => r.id === "4848889")!;
    expect(exit.end.kind).toBe("junction");
    expect(streets.map((r) => r.id)).toContain(exit.end.parent);
  });

  it("gives the lower road graph lines of a local street, joined to a GSI street at its ground ends", () => {
    const ellipsoidal = (_lat: number, _lon: number, h: number) => h + 36.9;
    const input = expresswayRoadInput(chunks, meta.runs, ellipsoidal);
    const lower = input.lines.filter((l) => l.cls === "street");
    expect(lower.length).toBeGreaterThan(0);
    for (const l of lower)
      expect(l).toMatchObject({ kind: "local", structure: "viaduct", level: 1, limit: 40 });
    const streetEnds = input.ends.filter((e) => e.cls === "street");
    expect(streetEnds).toHaveLength(4);
    // A GSI street through one of them: the end is joined by a ground connector of the same class.
    const e = streetEnds[0];
    const gsi: RoadLine = {
      coords: [e.lon - 0.0005, e.lat + 0.00005, e.lon + 0.0005, e.lat + 0.00005, e.lon + 0.0006, e.lat],
      width: 8,
      oneway: 0,
      kind: "local",
    };
    const box = [
      { ...gsi, coords: [e.lon - 0.01, e.lat - 0.01, e.lon + 0.01, e.lat - 0.01] },
      { ...gsi, coords: [e.lon - 0.01, e.lat + 0.01, e.lon + 0.01, e.lat + 0.01] },
    ];
    const reports: string[] = [];
    const joined = joinExpressway([gsi, ...box], { lines: input.lines, ends: [e] }, (d) =>
      reports.push(d.event),
    );
    expect(reports).toEqual([]);
    const connector = joined.find((l) => l.structure === "ground" && l.cls === "street");
    expect(connector).toMatchObject({ kind: "local", level: 0 });
  });
});

// The bridge model's own dimensions (scripts/blender/rainbow_bridge_spec.py), read from its source
// so the test follows the model when it changes.
const specSource = readFileSync(join(ROOT, "scripts", "blender", "rainbow_bridge_spec.py"), "utf8");
const specNumber = (name: string): number => {
  const m = new RegExp(`^${name} = ([\\d.]+)`, "m").exec(specSource);
  if (!m) throw new Error(`${name} not in rainbow_bridge_spec.py`);
  return Number(m[1]);
};
const pair = (name: string): [number, number] => {
  const m = new RegExp(`^${name} = ([\\d.]+), ([\\d.]+)`, "m").exec(specSource)!;
  return [Number(m[1]), Number(m[2])];
};

describe("the decks inside the bridge model (no tower, chord or hanger in a lane, no deck floating off the truss)", () => {
  const PARAPET = 0.5; // assumptions.PARAPET_WIDTH
  const [chordW] = pair("CHORD_W, CHORD_H");
  const [, legAcross] = pair("LEG_ALONG, LEG_ACROSS");
  const chordInner = specNumber("TRUSS_X") - chordW / 2;
  const legInner = specNumber("LEG_X") - legAcross / 2;
  const reach = (name: string) => {
    const d = deck(name);
    const hw = (d.section.lanes * d.section.laneWidth + d.section.shoulderL + d.section.shoulderR) / 2;
    const wall = Math.abs(d.bandOffset) + hw + PARAPET;
    // Left of travel is the outer side for both directions (forward at +offset, backward at −).
    return { wall, apron: wall + d.aprons.left };
  };

  it("keeps the lower floor, walls and walkways, inside the main truss's chords", () => {
    for (const name of ["lower:forward", "lower:backward"]) {
      const r = reach(name);
      expect(r.wall).toBeLessThan(chordInner);
      expect(r.apron).toBeLessThanOrEqual(specNumber("BARRIER_FACE") + 1e-9);
      expect(r.apron).toBeLessThan(chordInner);
    }
  });

  it("passes the upper floor between the tower legs, its 壁高欄 standing on the top chord", () => {
    for (const name of ["upper:forward", "upper:backward"]) {
      const r = reach(name);
      expect(r.wall).toBeLessThan(legInner);
      // The 壁高欄's inner face is the levels' barrier face, over the chord (inner face 14.0 m).
      expect(r.wall - PARAPET).toBeCloseTo(specNumber("BARRIER_FACE"), 6);
      expect(r.wall).toBeLessThan(specNumber("TRUSS_X") + chordW / 2);
    }
  });

  it("rests each floor's slab on the model's floor beams: no gap under it, and its top not inside them", () => {
    // The model stops its floor beams FLOOR_BEAM_GAP under each surface; the deck's slab
    // (expresswayDeck.ts SLAB) reaches below that, so no daylight shows between them, by less than
    // the slab itself (its top, the road, stays above the beams). Both read from their sources.
    const gap = specNumber("FLOOR_BEAM_GAP");
    expect(SLAB).toBeGreaterThan(gap);
    expect(SLAB - gap).toBeLessThan(SLAB);
  });
});

describe("structure overrides: the pieces around them", () => {
  it("measures the axis in the metres the game places the model by (LocalFrame, ≤ 2 cm at 463 m)", () => {
    // landmarks.ts puts the model at the origin in the local tangent frame and turns it by its bearing.
    const [lon0, lat0] = levels.axis.origin;
    const frame = new LocalFrame(lat0, lon0, 0);
    const b = (levels.axis.bearing * Math.PI) / 180;
    for (const [s, offset] of [
      [463, 0],
      [-463, 13.8],
      [250, -8.15],
      [-396.5, 7.15],
    ]) {
      const [lon, lat] = fromAxis(bridge, s, offset);
      const p = frame.toLocal(lat, lon, 0);
      // Local frame: +x east, −z north. +s along the bearing, +offset to its left.
      const east = s * Math.sin(b) - offset * Math.cos(b);
      const north = s * Math.cos(b) + offset * Math.sin(b);
      // 2 cm: the tangent frame bends away from the ellipsoid-radius plane by about s²·tan φ / 2R (1.2 cm
      // at 463 m); the 0.2 % of the sphere plane this replaced was 1 m there.
      expect(Math.hypot(p.x - east, -p.z - north), `s=${s} offset=${offset}`).toBeLessThanOrEqual(0.02);
    }
  });

  it("ranks decks as masters in a total order: of any two exactly one outranks the other", () => {
    const runs = new Map([
      ["1", { cls: "expressway" as const }],
      ["2", { cls: "street" as const }],
      ["3", { cls: "ramp" as const }],
      ["4", { cls: "street" as const }],
    ]);
    for (const a of runs.keys())
      for (const b of runs.keys()) {
        if (a === b) continue;
        expect(outranks(runs, a, b) !== outranks(runs, b, a), `${a} ${b}`).toBe(true);
      }
    // The main line over a street over a ramp (台場出口 ends on the 臨港道路).
    expect(outranks(runs, "1", "2")).toBe(true);
    expect(outranks(runs, "2", "3")).toBe(true);
  });

  it("classes a run by most of its length, not its first way (11号台場線 begins on a link)", () => {
    const net: Network = { ways: new Map(), nodes: new Map() };
    net.ways.set(1, normalizeWay(1, [1, 2], { highway: "motorway_link" }));
    net.ways.set(2, normalizeWay(2, [2, 3], { highway: "motorway" }));
    net.ways.set(3, normalizeStreetWay(3, [3, 4], { highway: "tertiary" }));
    expect(majorityClass(net, Int32Array.from([1, 1, 2, 2, 2]))).toBe("expressway");
    expect(majorityClass(net, Int32Array.from([1, 1, 1, 2, 2]))).toBe("ramp");
    expect(majorityClass(net, Int32Array.from([3, 3, 3, 1, 1]))).toBe("street");
    // A tie goes to the main line, then the street.
    expect(majorityClass(net, Int32Array.from([1, 2]))).toBe("expressway");
  });

  it("parses --range: one or more named ranges joined by commas, or all", () => {
    expect(parseRanges(undefined)).toEqual({
      names: [...DEFAULT_RANGES],
      boxes: DEFAULT_RANGES.map((n) => RANGES[n]),
    });
    expect(parseRanges("rainbow").names).toEqual(["rainbow"]);
    expect(parseRanges("hamazakibashi,rainbow").boxes).toEqual([RANGES.hamazakibashi, RANGES.rainbow]);
    expect(parseRanges("all")).toEqual({ names: [], boxes: null });
    expect(() => parseRanges("rainbow,nowhere")).toThrow(/unknown --range nowhere/);
  });

  it("draws the aprons but keeps them out of the collider (a car cannot drive onto the guideway)", () => {
    const DIR = join(ROOT, "public", "data", "expressway");
    const all = readdirSync(DIR)
      .filter((f) => /^\d+-\d+\.json$/.test(f))
      .flatMap((f) => (JSON.parse(readFileSync(join(DIR, f), "utf8")) as XwTile).chunks);
    const c = all.find((x) => x.over !== null && x.over.apronL > 0 && x.over.apronR > 0)!;
    const [lon0, lat0] = [c.st[1], c.st[2]];
    const frame = new LocalFrame(lat0, lon0, 40);
    const steps = deckArraySteps(c, { frame, ellipsoidal: (_a, _b, h) => h + 36.9 });
    let r = steps.next();
    while (!r.done) r = steps.next();
    const { arrays, collider, rings } = r.value;
    const hw = (c.lanes * c.laneWidth + c.shoulderL + c.shoulderR) / 2;
    const edge = hw + 0.5;
    // Across distance of a point from the chunk's centre line: the chord of its first and last rings
    // (the girder is straight; a ring's own tangent carries the chain plane's heading error).
    const a = rings[0].c;
    const b = rings[rings.length - 1].c;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const left = { x: (b.z - a.z) / len, z: -(b.x - a.x) / len };
    const across = (x: number, z: number) => (x - a.x) * left.x + (z - a.z) * left.z;
    const extent = (pos: Float32Array) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < pos.length; i += 3) {
        const u = across(pos[i], pos[i + 2]);
        lo = Math.min(lo, u);
        hi = Math.max(hi, u);
      }
      return { lo, hi };
    };
    const solid = extent(collider.position);
    const drawn = extent(arrays.position);
    expect(solid.hi).toBeLessThanOrEqual(edge + 0.01);
    expect(solid.lo).toBeGreaterThanOrEqual(-edge - 0.01);
    expect(drawn.hi).toBeGreaterThanOrEqual(edge + c.over!.apronL - 0.01);
    expect(drawn.lo).toBeLessThanOrEqual(-edge - c.over!.apronR + 0.01);
  });
});
