import { BoxGeometry, Color, Matrix4, MeshBasicMaterial, Scene, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { RoadInstances } from "../src/world/roadInstances";

describe("road instance reuse", () => {
  it("keeps identity while replacing matrices, colors, count and stale bounds", () => {
    const pool = new RoadInstances(),
      geometry = new BoxGeometry(),
      material = new MeshBasicMaterial();
    pool.begin();
    const first = pool.take(geometry, material, 3);
    first.setColorAt(0, new Color("red"));
    first.computeBoundingSphere();
    pool.end();
    const version = first.instanceMatrix.version;
    pool.begin();
    expect(first.visible).toBe(false);
    const second = pool.take(geometry, material, 2);
    second.setMatrixAt(0, new Matrix4().makeTranslation(10, 20, 30));
    second.setColorAt(0, new Color("blue"));
    pool.end();
    expect(second).toBe(first);
    expect(second.count).toBe(2);
    expect(second.visible).toBe(true);
    expect(second.instanceMatrix.version).toBeGreaterThan(version);
    expect(second.instanceColor!.version).toBeGreaterThan(0);
    expect(second.boundingSphere).toBeNull();
    const matrix = new Matrix4();
    second.getMatrixAt(0, matrix);
    expect(matrix.elements.slice(12, 15)).toEqual([10, 20, 30]);
  });

  it("grows capacity and disposes GPU instance data without disposing shared assets", () => {
    const pool = new RoadInstances(),
      geometry = new BoxGeometry(),
      material = new MeshBasicMaterial();
    const gd = vi.spyOn(geometry, "dispose"),
      md = vi.spyOn(material, "dispose");
    pool.begin();
    const first = pool.take(geometry, material, 2);
    pool.end();
    const scene = new Scene();
    scene.add(first);
    const disposed = vi.fn();
    first.addEventListener("dispose", disposed);
    pool.begin();
    const grown = pool.take(geometry, material, 5);
    pool.end();
    expect(grown).not.toBe(first);
    expect(grown.instanceMatrix.count).toBeGreaterThanOrEqual(5);
    expect(disposed).toHaveBeenCalledOnce();
    expect(first.parent).toBeNull();
    expect(gd).not.toHaveBeenCalled();
    expect(md).not.toHaveBeenCalled();
    pool.clear();
    expect(gd).not.toHaveBeenCalled();
    expect(md).not.toHaveBeenCalled();
  });

  it("moves retained instances with the origin and resets that transform when new local matrices arrive", () => {
    const pool = new RoadInstances();
    const geometry = new BoxGeometry(),
      material = new MeshBasicMaterial();
    pool.begin();
    const mesh = pool.take(geometry, material, 1);
    mesh.setMatrixAt(0, new Matrix4().makeTranslation(5, 2, 7));
    pool.end();
    const shift = new Matrix4().makeRotationY(0.2).setPosition(-500, 3, 100);
    pool.reanchor(shift);
    mesh.updateMatrixWorld(true);
    const local = new Matrix4();
    mesh.getMatrixAt(0, local);
    const expected = new Vector3(5, 2, 7).applyMatrix4(shift);
    expect(
      new Vector3().setFromMatrixPosition(local.premultiply(mesh.matrixWorld)).distanceTo(expected),
    ).toBeLessThan(1e-6);
    pool.begin();
    const reused = pool.take(geometry, material, 1);
    reused.setMatrixAt(0, new Matrix4().makeTranslation(expected.x, expected.y, expected.z));
    pool.end();
    reused.updateMatrixWorld(true);
    reused.getMatrixAt(0, local);
    expect(reused).toBe(mesh);
    expect(
      new Vector3().setFromMatrixPosition(local.premultiply(reused.matrixWorld)).distanceTo(expected),
    ).toBeLessThan(1e-5);
  });

  it("keeps distinct batches with shared assets and releases batches absent from the next update", () => {
    const pool = new RoadInstances(),
      geometry = new BoxGeometry(),
      material = new MeshBasicMaterial();
    pool.begin();
    const a = pool.take(geometry, material, 1),
      b = pool.take(geometry, material, 1);
    pool.end();
    expect(a).not.toBe(b);
    const disposed = vi.fn();
    b.addEventListener("dispose", disposed);
    pool.begin();
    expect(pool.take(geometry, material, 0)).toBe(a);
    pool.end();
    expect(a.count).toBe(0);
    expect(disposed).toHaveBeenCalledOnce();
    const cleared = vi.fn();
    a.addEventListener("dispose", cleared);
    pool.clear();
    expect(cleared).toHaveBeenCalledOnce();
  });
});
