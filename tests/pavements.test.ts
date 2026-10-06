import { Vector2 } from "three";
import { describe, expect, it } from "vitest";
import { liftedHeights, liftedHeightSteps, polygonsOf } from "../src/world/pavements";

const square = (x0: number, y0: number, x1: number, y1: number, clockwise = true) => {
  // Tile space has y down, so "clockwise on screen" is the MVT outer-ring winding.
  const pts = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  return clockwise ? pts : pts.reverse();
};

describe("PLATEAU pavement polygons from MVT", () => {
  it("groups holes with the outer ring before them", () => {
    const polys = polygonsOf(
      [square(10, 10, 90, 90), square(40, 40, 60, 60, false), square(100, 10, 120, 30)],
      4096,
    );
    expect(polys.map((p) => p.length)).toEqual([2, 1]);
  });

  it("clips the shared tile buffer so neighbouring tiles do not overlap", () => {
    const [[ring]] = polygonsOf([square(-200, 100, 300, 200)], 4096);
    expect(Math.min(...ring.map((p) => p.x))).toBe(0);
    expect(ring).toHaveLength(4);
  });

  it("raises a long triangle where the ground inside it is higher than at its corners", () => {
    const pts = [new Vector2(0, 0), new Vector2(40, 0), new Vector2(0, 40)];
    const bump = (x: number, z: number) => (Math.hypot(x - 13, z - 13) < 8 ? 0.4 : 0);
    const h = liftedHeights(pts, [[0, 1, 2]], bump);
    const centre = (h[0] + h[1] + h[2]) / 3;
    expect(centre).toBeGreaterThanOrEqual(0.4 - 1e-9);
  });

  it("bounds each large-polygon height step without skipping either pass or changing caller points", () => {
    const pts = Array.from({ length: 600 }, (_, i) => new Vector2(i - 300, (i % 23) - 11));
    const tris = Array.from({ length: 598 }, (_, i) => [i, i + 1, i + 2]);
    const original = pts.map((p) => p.toArray());
    let queries = 0,
      previous = 0,
      pauses = 0;
    const steps = liftedHeightSteps(pts, tris, (x, z) => {
      queries++;
      return x * 0.1 + z * 0.2;
    });
    for (;;) {
      const result = steps.next();
      expect(queries - previous).toBeLessThanOrEqual(128);
      previous = queries;
      const isDone = result.done;
      if (isDone) {
        result.value.forEach((h, i) => expect(h).toBeCloseTo(pts[i].x * 0.1 + pts[i].y * 0.2, 11));
        break;
      }
      pauses++;
    }
    expect(pauses).toBeGreaterThan(20);
    expect(queries).toBe(pts.length + tris.length * 8);
    expect(pts.map((p) => p.toArray())).toEqual(original);
  });
});
