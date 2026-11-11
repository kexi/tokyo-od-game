import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { PARAPET_HEIGHT } from "../src/expressway/assumptions";
import type { XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { LocalFrame } from "../src/geo/frame";
import { frameAt, hermite, surfaceHeight } from "../src/expressway/profile";
import { deckArraySteps, type GeoToLocal, isSupportedMeta } from "../src/world/expresswayDeck";

// A 200 m chunk going east, climbing from T.P. 10 m to 14 m over ground at T.P. 3 m, except its
// last station where the ground rises to 1 m under the deck (as near a touchdown).
const plane = planeAt(139.75, 35.65);
function chunk(): XwChunk {
  const st: number[] = [];
  for (let i = 0; i <= 20; i++) {
    const [lon, lat] = plane.toLonLat(i * 10, 0);
    const isLast = i === 20;
    st.push(i * 10, lon, lat, 10 + i * 0.2, 0, isLast ? 13 : 3, 0.02);
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
    g0: 0.02,
    g1: 0.02,
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

const N = 36.9; // a constant geoid for the test
const place = (frame: LocalFrame): GeoToLocal => ({ frame, ellipsoidal: (_lat, _lon, h) => h + N });

function build(frame: LocalFrame) {
  const steps = deckArraySteps(chunk(), place(frame));
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

describe("高架の床版の押し出し（描画のみ、P1）", () => {
  const frame = new LocalFrame(35.65, 139.75, 40);
  const { arrays, stations } = build(frame);

  it("puts the road surface at each station's compiled height (T.P. + geoid through the local frame)", () => {
    const c = chunk();
    for (let i = 0; i < stations.length; i++) {
      const lon = c.st[i * 7 + 1];
      const lat = c.st[i * 7 + 2];
      const expected = frame.toLocal(lat, lon, c.st[i * 7 + 3] + N);
      expect(stations[i].distanceTo(expected)).toBeLessThan(1e-6);
    }
  });

  it("raises the 壁高欄 by its height above the surface and hangs the girder 2.2 m below it", () => {
    const ys: number[] = [];
    for (let i = 1; i < arrays.position.length; i += 3) ys.push(arrays.position[i]);
    const top = Math.max(...ys);
    const surfaceMax = Math.max(...stations.map((s) => s.y));
    expect(top).toBeCloseTo(surfaceMax + PARAPET_HEIGHT.value, 3);
    const bottom = Math.min(...ys);
    expect(bottom).toBeCloseTo(stations[0].y - 2.2, 3);
  });

  it("never pushes the girder through the ground: near a touchdown it shortens to a wall on it", () => {
    // Last station: surface T.P. 14 m over ground T.P. 13 m → the soffit stays 0.3 m into the ground at most.
    const last = stations[stations.length - 1];
    const groundY = last.y - 1;
    const nearLast: number[] = [];
    for (let i = 0; i < arrays.position.length; i += 3) {
      const p = new Vector3(arrays.position[i], arrays.position[i + 1], arrays.position[i + 2]);
      // The chunk runs east (+x): the last cross-section is the vertices at the last station's x.
      if (Math.abs(p.x - last.x) < 0.5) nearLast.push(p.y);
    }
    expect(Math.min(...nearLast)).toBeGreaterThanOrEqual(groundY - 0.3 - 1e-3);
  });

  it("is the same deck after a change of origin: building in the new frame equals moving the old one", () => {
    const next = new LocalFrame(35.66, 139.76, 35);
    const moved = build(next);
    const m = next.transformFrom(frame);
    for (let i = 0; i < stations.length; i++) {
      expect(stations[i].clone().applyMatrix4(m).distanceTo(moved.stations[i])).toBeLessThan(1e-3);
    }
  });
});

describe("床版の上面は測点間もエルミート補間の面に沿う（P3 の surfaceY と同じ曲線）", () => {
  // A 200 m chunk going east over a crest of radius 450 m (第22条 at 40 km/h), stations every 20 m:
  // a straight chord between them would leave the curve by 20² / (8·450) = 0.11 m.
  const R = 450;
  const zAt = (s: number) => 10 + 0.04 * s - (s * s) / (2 * R);
  const gAt = (s: number) => 0.04 - s / R;
  function crest(): XwChunk {
    const st: number[] = [];
    for (let i = 0; i <= 10; i++) {
      const s = i * 20;
      const [lon, lat] = plane.toLonLat(s, 0);
      st.push(s, lon, lat, zAt(s), 0, 3, gAt(s));
    }
    return { ...chunk(), st, g0: gAt(0), g1: gAt(200) };
  }
  const frame = new LocalFrame(35.65, 139.75, 40);
  const steps = deckArraySteps(crest(), place(frame));
  let r = steps.next();
  while (!r.done) r = steps.next();
  const { arrays } = r.value;

  it("puts every vertex of the road surface on the curve, and keeps the flat faces between them within 1 cm of it", () => {
    const isAsphalt = (i: number) =>
      Math.abs(arrays.color[i] - 0.16) < 1e-6 && Math.abs(arrays.color[i + 2] - 0.17) < 1e-6;
    const [lon0, lat0] = plane.toLonLat(0, 0);
    const [lon1] = plane.toLonLat(200, 0);
    const x0 = frame.toLocal(lat0, lon0, N).x;
    const x1 = frame.toLocal(lat0, lon1, N).x;
    // The analytic parabola under a local point (by its east coordinate).
    const curveY = (x: number) => {
      const s = ((x - x0) / (x1 - x0)) * 200;
      return frame.toLocal(lat0, lon0 + ((lon1 - lon0) * s) / 200, zAt(s) + N).y;
    };
    const P = arrays.position;
    let checked = 0;
    for (let tri = 0; tri < P.length; tri += 9) {
      if (!isAsphalt(tri)) continue;
      for (let v = 0; v < 3; v++) {
        const i = tri + v * 3;
        // Float32 positions a few hundred metres from the origin: ~1e-4 m.
        expect(Math.abs(P[i + 1] - curveY(P[i]))).toBeLessThan(1e-3);
        // The middle of each edge lies on the flat face: within the 1 cm the deck allows.
        const j = tri + ((v + 1) % 3) * 3;
        const midX = (P[i] + P[j]) / 2;
        const midY = (P[i + 1] + P[j + 1]) / 2;
        expect(Math.abs(midY - curveY(midX))).toBeLessThan(0.01 + 1e-3);
        checked++;
      }
    }
    // More cross-sections than stations: the slab follows the curve between them.
    expect(checked).toBeGreaterThan(10 * 6 * 2);
  });
});

describe("面の契約（profile.ts frameAt・surfaceHeight、デッキと P3 が共有）", () => {
  // Two stations 20 m apart going east, on a parabola, with a bank changing from 0 to 4 %.
  const st = [0, 139.75, 35.65, 10, 0, 3, 0.02, 20, 139.7502, 35.65, 10.3, 0.04, 3.2, 0.01];
  it("interpolates the plan and the bank linearly and the elevation by the Hermite cubic", () => {
    const f = frameAt(st, 5);
    expect(f.lon).toBeCloseTo(139.75005, 9);
    expect(f.bank).toBeCloseTo(0.01, 12);
    expect(f.ground).toBeCloseTo(3.05, 12);
    expect(f.z).toBeCloseTo(hermite(0, 10, 0.02, 20, 10.3, 0.01, 5).z, 12);
  });

  it("raises the left edge by bank × offset only when drawn banked", () => {
    const f = frameAt(st, 10);
    expect(surfaceHeight(f, 4, true)).toBeCloseTo(f.z + 0.02 * 4, 12);
    expect(surfaceHeight(f, -4, true)).toBeCloseTo(f.z - 0.02 * 4, 12);
    expect(surfaceHeight(f, 4, false)).toBe(f.z);
  });

  it("the game refuses tiles of another format version", () => {
    expect(isSupportedMeta({ version: 6 })).toBe(true);
    // 2 is P3's, 3 was P6's alone (maxspeed per chunk), 4 P7's (no maxspeed), 5 both with the runs,
    // diagnostics and entrances in meta.json: 6 (P2.7-4) moved those to the tiles and report.json.
    for (const v of [1, 2, 3, 4, 5])
      expect(isSupportedMeta({ version: v } as unknown as { version: 6 })).toBe(false);
  });

  it("reads files of its version with no features and with P9's (below), and refuses a feature it does not know", () => {
    expect(isSupportedMeta({ version: 6 })).toBe(true);
    expect(isSupportedMeta({ version: 6, features: ["below"] })).toBe(true);
    expect(isSupportedMeta({ version: 6, features: ["below", "lanes"] })).toBe(false);
  });
});
