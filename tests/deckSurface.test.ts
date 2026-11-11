import { describe, expect, it } from "vitest";
import { PARAPET_WIDTH } from "../src/expressway/assumptions";
import type { XwChunk } from "../src/expressway/format";
import { haversine, planeAt } from "../src/expressway/geo";
import { carriagewayWidth } from "../src/expressway/section";
import { LocalFrame } from "../src/geo/frame";
import { CUT_STEP_M, deckCutPoints } from "../src/world/deckCuts";
import { DECK_COLOURS, DECK_SURFACE, deckSurfaceAttribute, deckSurfaceOf } from "../src/world/deckSurface";
import { deckArraySteps } from "../src/world/expresswayDeck";

// A 200 m chunk going east at T.P. 12 m over ground at T.P. 3 m, with two piers.
const plane = planeAt(139.75, 35.65);
function chunk(): XwChunk {
  const st: number[] = [];
  for (let i = 0; i <= 20; i++) {
    const [lon, lat] = plane.toLonLat(i * 10, 0);
    st.push(i * 10, lon, lat, 12, 0, 3, 0);
  }
  return {
    id: "1:0",
    run: "1",
    chain: "c1",
    k: 0,
    cls: "expressway",
    ref: "C1",
    name: null,
    structure: "viaduct",
    over: null,
    lanes: 2,
    laneWidth: 3.25,
    shoulderL: 1.25,
    shoulderR: 0.75,
    basis: "statute",
    V: 60,
    maxspeed: null,
    vh: 50,
    gmax: 0.05,
    g0: 0,
    g1: 0,
    h0: 0,
    h1: 0,
    girder: 2.2,
    st,
    piers: [60, 3, 140, 3],
    cross: [],
    blocked: [],
    decks: [],
    prev: null,
    next: null,
  };
}

function build() {
  const frame = new LocalFrame(35.65, 139.75, 40);
  const steps = deckArraySteps(chunk(), { frame, ellipsoidal: (_lat, _lon, h) => h + 36.9 });
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

describe("deck surfaces read from the deck's flat colours (deckSurface.ts)", () => {
  it("maps each palette colour to its own surface code", () => {
    for (const [name, [r, g, b]] of Object.entries(DECK_COLOURS))
      expect(deckSurfaceOf(r, g, b)).toBe(DECK_SURFACE[name as keyof typeof DECK_SURFACE]);
  });

  it("finds every colour the deck builder writes in the palette exactly (a new colour would go untextured)", () => {
    const { arrays } = build();
    const palette = Object.values(DECK_COLOURS);
    const seen = new Set<number>();
    for (let i = 0; i < arrays.color.length; i += 3) {
      const [r, g, b] = [arrays.color[i], arrays.color[i + 1], arrays.color[i + 2]];
      const isInPalette = palette.some(([pr, pg, pb]) => Math.hypot(r - pr, g - pg, b - pb) < 1e-6);
      expect(isInPalette).toBe(true);
      seen.add(deckSurfaceOf(r, g, b));
    }
    // Road, concrete, soffit, piers and white paint are all there in a plain chunk with piers.
    for (const code of [DECK_SURFACE.asphalt, DECK_SURFACE.concrete, DECK_SURFACE.soffit, DECK_SURFACE.pier])
      expect(seen.has(code)).toBe(true);
  });

  it("gives each vertex its depth below the triangle's top edge and the triangle's height", () => {
    // A wall triangle 3 m tall (top at y 10) and a flat road triangle.
    const position = new Float32Array([0, 10, 0, 0, 7, 0, 1, 10, 0, 0, 5, 0, 1, 5, 0, 0, 5, 1]);
    const [r, g, b] = DECK_COLOURS.concrete;
    const [ar, ag, ab] = DECK_COLOURS.asphalt;
    const color = new Float32Array([r, g, b, r, g, b, r, g, b, ar, ag, ab, ar, ag, ab, ar, ag, ab]);
    const a = deckSurfaceAttribute(position, color);
    expect(Array.from(a.slice(0, 9))).toEqual([1, 0, 3, 1, 3, 3, 1, 0, 3]);
    expect(Array.from(a.slice(9))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("keeps the depth within the grade of one ring step on a built deck (the streaks hang from the edge)", () => {
    const { arrays } = build();
    const a = deckSurfaceAttribute(arrays.position, arrays.color);
    for (let i = 0; i < a.length; i += 3) {
      expect(a[i + 1]).toBeGreaterThanOrEqual(0);
      expect(a[i + 1]).toBeLessThanOrEqual(a[i + 2] + 1e-6);
    }
  });
});

describe("deck cut points (deckCuts.ts)", () => {
  it("cover the deck's whole width out past the 壁高欄, every CUT_STEP_M or closer, at the soffit", () => {
    const c = chunk();
    const points = deckCutPoints(c);
    const half = carriagewayWidth(c) / 2 + PARAPET_WIDTH.value + 0.5;
    const ys = points.map((p) => plane.toXY(p.lon, p.lat)[1]);
    expect(Math.max(...ys)).toBeCloseTo(half, 3);
    expect(Math.min(...ys)).toBeCloseTo(-half, 3);
    for (const p of points) expect(p.soffitTp).toBeCloseTo(12 - c.girder, 6);
    // Centre points in order along the chunk: no gap wider than the step, and both ends reached.
    const centres = points.filter((p) => Math.abs(plane.toXY(p.lon, p.lat)[1]) < 1e-6);
    for (let i = 1; i < centres.length; i++)
      expect(
        haversine(centres[i - 1].lon, centres[i - 1].lat, centres[i].lon, centres[i].lat),
      ).toBeLessThanOrEqual(CUT_STEP_M + 1e-6);
    expect(plane.toXY(centres[0].lon, centres[0].lat)[0]).toBeCloseTo(0, 3);
    expect(plane.toXY(centres.at(-1)!.lon, centres.at(-1)!.lat)[0]).toBeCloseTo(200, 3);
  });
});
