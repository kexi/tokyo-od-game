import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { PARAPET_HEIGHT } from "../src/expressway/assumptions";
import type { XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { LocalFrame } from "../src/geo/frame";
import { deckArraySteps, type GeoToLocal } from "../src/world/expresswayDeck";

// A 200 m chunk going east, climbing from T.P. 10 m to 14 m over ground at T.P. 3 m, except its
// last station where the ground rises to 1 m under the deck (as near a touchdown).
const plane = planeAt(139.75, 35.65);
function chunk(): XwChunk {
  const st: number[] = [];
  for (let i = 0; i <= 20; i++) {
    const [lon, lat] = plane.toLonLat(i * 10, 0);
    const isLast = i === 20;
    st.push(i * 10, lon, lat, 10 + i * 0.2, 0, isLast ? 13 : 3);
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
    lanes: 2,
    laneWidth: 3.25,
    shoulderL: 1.25,
    shoulderR: 0.75,
    basis: "statute",
    V: 60,
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
      const lon = c.st[i * 6 + 1];
      const lat = c.st[i * 6 + 2];
      const expected = frame.toLocal(lat, lon, c.st[i * 6 + 3] + N);
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
