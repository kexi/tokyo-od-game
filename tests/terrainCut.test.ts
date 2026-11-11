import RAPIER from "@dimforge/rapier3d-compat";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { XwChunk } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { LocalFrame } from "../src/geo/frame";
import { latToTileY, lonToTileX, tileXToLon, tileYToLat } from "../src/geo/tiles";
import { GroundCuts } from "../src/world/groundCuts";
import { colliderTriangles, CUT_SUBDIVISIONS } from "../src/world/terrainCut";

beforeAll(() => RAPIER.init());
const worlds: RAPIER.World[] = [];
afterEach(() => worlds.splice(0).forEach((w) => w.free()));

/** A flat S × S grid of 1 m cells at y = 0 (x = i, z = j), split along one diagonal per cell. */
function grid(S: number) {
  const positions = new Float32Array((S + 1) * (S + 1) * 3);
  for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) positions.set([i, 0, j], (j * (S + 1) + i) * 3);
  const index: number[] = [];
  for (let j = 0; j < S; j++)
    for (let i = 0; i < S; i++) {
      const a = j * (S + 1) + i;
      index.push(a, a + S + 1, a + 1, a + 1, a + S + 1, a + S + 2);
    }
  return { positions, index };
}

/** Whether the trimesh covers the plan point (x, z) (some triangle holds it). */
function covers(mesh: { vertices: Float32Array; indices: Uint32Array }, x: number, z: number): boolean {
  const v = mesh.vertices;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t] * 3, mesh.indices[t + 1] * 3, mesh.indices[t + 2] * 3];
    const d1 = (x - v[b]) * (v[a + 2] - v[b + 2]) - (v[a] - v[b]) * (z - v[b + 2]);
    const d2 = (x - v[c]) * (v[b + 2] - v[c + 2]) - (v[b] - v[c]) * (z - v[c + 2]);
    const d3 = (x - v[a]) * (v[c + 2] - v[a + 2]) - (v[c] - v[a]) * (z - v[a + 2]);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(hasNeg && hasPos)) return true;
  }
  return false;
}

describe("地形のコライダーの切り抜き（terrainCut.ts、P9 レビュー C1）", () => {
  it("drops only the triangles wholly on water, and keeps every triangle where nothing is cut", () => {
    const { positions, index } = grid(4);
    const all = colliderTriangles(positions, index, 4, null, null);
    expect(all.indices.length).toBe(index.length);
    // Water over i ≤ 2: columns 0 and 1 are wholly on it, column 2 reaches the bank.
    const wet = colliderTriangles(positions, index, 4, (i) => i <= 2, null);
    expect(covers(wet, 0.5, 0.5)).toBe(false);
    expect(covers(wet, 1.5, 0.5)).toBe(false);
    expect(covers(wet, 2.5, 0.5)).toBe(true);
    expect(covers(wet, 3.5, 3.5)).toBe(true);
  });

  it("clips a triangle the cut-out touches to the pieces clear of it: the ground right beside a narrow cut keeps its collider", () => {
    // 4 cells of 1 m; a cut 0.3 m wide down the middle (1.85 ≤ i ≤ 2.15).
    const S = 4;
    const { positions, index } = grid(S);
    const isCut = (i: number) => i >= 1.85 && i <= 2.15;
    const mesh = colliderTriangles(positions, index, S, null, isCut);
    for (const z of [0.3, 1.7, 3.2]) {
      expect(covers(mesh, 2, z)).toBe(false);
      // A piece is 1/CUT_SUBDIVISIONS of a cell: the ground is back within two pieces of the cut.
      const reach = 2 / CUT_SUBDIVISIONS;
      expect(covers(mesh, 1.85 - reach, z)).toBe(true);
      expect(covers(mesh, 2.15 + reach, z)).toBe(true);
      expect(covers(mesh, 0.5, z)).toBe(true);
    }
    // The pieces lie on the triangles' plane (y = 0 here) and keep their winding (normals up).
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [mesh.indices[t] * 3, mesh.indices[t + 1] * 3, mesh.indices[t + 2] * 3];
      const v = mesh.vertices;
      expect(v[a + 1]).toBe(0);
      const ny = (v[b + 2] - v[a + 2]) * (v[c] - v[a]) - (v[b] - v[a]) * (v[c + 2] - v[a + 2]);
      expect(ny).toBeGreaterThan(0);
    }
  });

  it("beside a tunnel portal whose ground is cut away, a ray comes down on the ground; inside the hole it falls through", () => {
    // A z15 terrain chunk of 64 cells round a synthetic tunnel chunk whose ground is near its roof
    // (a hole all along), as terrain.ts builds its collider (grid → local, cutTest of GroundCuts).
    const plane = planeAt(139.75, 35.65);
    const st: number[] = [];
    for (let s = 0; s <= 100; s += 10) {
      const [lon, lat] = plane.toLonLat(100 + s, 0);
      st.push(s, lon, lat, 10, 0, 14, 0);
    }
    const chunk = {
      id: "B:0",
      structure: "tunnel",
      lanes: 2,
      laneWidth: 3.25,
      shoulderL: 1.25,
      shoulderR: 0.75,
      st,
    } as unknown as XwChunk;
    const cuts = new GroundCuts(null);
    cuts.addChunk(chunk);
    const [lonMid, latMid] = plane.toLonLat(150, 0);
    const tx = Math.floor(lonToTileX(lonMid, 15));
    const ty = Math.floor(latToTileY(latMid, 15));
    const test = cuts.cutTest(tx, ty)!;
    expect(test).not.toBeNull();
    const S = 64;
    const frame = new LocalFrame(latMid, lonMid, 0);
    const positions = new Float32Array((S + 1) * (S + 1) * 3);
    for (let j = 0; j <= S; j++)
      for (let i = 0; i <= S; i++) {
        const p = frame.toLocal(tileYToLat(ty + j / S, 15), tileXToLon(tx + i / S, 15), 0);
        positions.set([p.x, p.y, p.z], (j * (S + 1) + i) * 3);
      }
    const { index } = grid(S);
    const mesh = colliderTriangles(positions, index, S, null, (i, j) => test(i / S, j / S));
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worlds.push(world);
    world.createCollider(RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices));
    world.step();
    const down = (north: number) => {
      const [lon, lat] = plane.toLonLat(150, north);
      const p = frame.toLocal(lat, lon, 0);
      const hit = world.castRay(
        new RAPIER.Ray({ x: p.x, y: p.y + 20, z: p.z }, { x: 0, y: -1, z: 0 }),
        60,
        true,
      );
      return hit === null ? null : 20 - hit.timeOfImpact;
    };
    // The hole is the bore's half width (4.25 + walkway 0.75 + wall 0.6 + headwall 1.2) + 0.3 m.
    expect(down(0)).toBeNull();
    expect(down(6.5)).toBeNull();
    for (const north of [8.5, 10, 16, -8.5, -16]) {
      const y = down(north);
      expect(y, `${north} m beside the axis`).not.toBeNull();
      expect(Math.abs(y!)).toBeLessThan(0.05);
    }
  });
});
