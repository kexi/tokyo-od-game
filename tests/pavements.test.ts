import { Vector2 } from "three";
import { describe, expect, it } from "vitest";
import { liftedHeights, polygonsOf } from "../src/world/pavements";

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
});
