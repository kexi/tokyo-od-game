import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { BuildingFootprints } from "../src/world/buildingFootprints";

const ring = (x0: number, z0: number, x1: number, z1: number) => [
  new Vector3(x0, 0, z0),
  new Vector3(x1, 0, z0),
  new Vector3(x1, 0, z1),
  new Vector3(x0, 0, z1),
];
function geometry(points: number[], indexed = true): BufferGeometry {
  const result = new BufferGeometry();
  result.setAttribute("position", new BufferAttribute(Float32Array.from(points), 3));
  if (indexed) result.setIndex(Array.from({ length: points.length / 3 }, (_, i) => i));
  return result;
}

describe("landmark building cut-outs", () => {
  it("collapses indexed triangles by centre and preserves positions, ECEF input and unaffected indices", () => {
    const points = [1, 0, 1, 2, 0, 1, 1, 0, 2, 8, 0, 8, 9, 0, 8, 8, 0, 9];
    const g = geometry(points),
      ecef = Float32Array.from(points),
      cutter = new BuildingFootprints();
    cutter.setRings([ring(0, 0, 4, 4), ring(100, 100, 200, 200)]);
    expect(cutter.cut(g, ecef, new Matrix4())).toBe(1);
    expect(Array.from(g.index!.array)).toEqual([0, 0, 0, 3, 4, 5]);
    expect(Array.from(g.getAttribute("position").array)).toEqual(points);
    expect(Array.from(ecef)).toEqual(points);
    expect(g.index!.version).toBe(1);
    expect((g.getAttribute("position") as BufferAttribute).version).toBe(0);
  });

  it("collapses non-indexed centres inside a concave footprint while retaining centres in its notch", () => {
    const cutter = new BuildingFootprints();
    cutter.setRings([
      [...ring(0, 0, 4, 1).slice(0, 3), new Vector3(1, 0, 1), new Vector3(1, 0, 4), new Vector3(0, 0, 4)],
    ]);
    const points = [0, 0, 0, 1, 0, 0, 0, 0, 1, 2, 0, 2, 3, 0, 2, 2, 0, 3];
    const g = geometry(points, false);
    expect(cutter.cut(g, Float32Array.from(points), new Matrix4())).toBe(1);
    expect(Array.from(g.getAttribute("position").array)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 3, 0, 2, 2, 0, 3,
    ]);
    expect((g.getAttribute("position") as BufferAttribute).version).toBe(1);
  });

  it("skips unrelated triangle reads without changing either GPU version", () => {
    const points = [8, 0, 8, 9, 0, 8, 8, 0, 9],
      g = geometry(points),
      cutter = new BuildingFootprints();
    cutter.setRings([ring(0, 0, 4, 4)]);
    const reads = vi.spyOn(g.index!, "getX");
    expect(cutter.cut(g, Float32Array.from(points), new Matrix4())).toBe(0);
    expect(reads).not.toHaveBeenCalled();
    expect(g.index!.version).toBe(0);
    expect((g.getAttribute("position") as BufferAttribute).version).toBe(0);
  });

  it("retains the Float32-rounded left edge even when the double coordinate is outside", () => {
    const x = 2 ** 24,
      points = [x, 0, 1, x, 0, 2, x, 0, 3],
      g = geometry(points),
      cutter = new BuildingFootprints();
    cutter.setRings([ring(x, 0, x + 0.5, 4)]);
    expect(cutter.cut(g, Float32Array.from(points), new Matrix4().makeTranslation(1, 0, 0))).toBe(1);
    expect(Array.from(g.index!.array)).toEqual([0, 0, 0]);
  });

  it("replaces footprint bounds after origin changes and does not read stale larger-mesh scratch", () => {
    const cutter = new BuildingFootprints(),
      matrix = new Matrix4(),
      points = [1, 0, 1, 2, 0, 1, 1, 0, 2],
      large = [...points, 8, 0, 8, 9, 0, 8, 8, 0, 9];
    cutter.setRings([ring(0, 0, 4, 4)]);
    expect(cutter.cut(geometry(large), Float32Array.from(large), matrix)).toBe(1);
    cutter.setRings([ring(100, 100, 104, 104)]);
    const small = geometry(points);
    expect(cutter.cut(small, Float32Array.from(points), matrix.makeTranslation(100, 0, 100))).toBe(1);
    cutter.setRings([]);
    const unchanged = geometry(points);
    expect(cutter.cut(unchanged, Float32Array.from(points), matrix)).toBe(0);
    expect(Array.from(unchanged.index!.array)).toEqual([0, 1, 2]);
  });

  it("still removes finite triangles when unused vertices contain NaN", () => {
    const points = [1, 0, 1, 2, 0, 1, 1, 0, 2, NaN, NaN, NaN],
      g = geometry(points),
      cutter = new BuildingFootprints();
    g.setIndex([0, 1, 2]);
    cutter.setRings([ring(0, 0, 4, 4)]);
    expect(cutter.cut(g, Float32Array.from(points), new Matrix4())).toBe(1);
    expect(Array.from(g.index!.array)).toEqual([0, 0, 0]);
  });
});
