import { BoxGeometry, Mesh, MeshBasicMaterial, Scene } from "three";
import { describe, expect, it, vi } from "vitest";
import { RoadPlates } from "../src/world/roadPlates";

describe("roadside text plates", () => {
  it("reuses duplicate text plates independently, resets old poses and releases obsolete content", () => {
    const dispose = vi.fn();
    const create = vi.fn(() => new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    const pool = new RoadPlates(dispose);
    pool.begin();
    const a = pool.take("junction", create),
      b = pool.take("junction", create),
      old = pool.take("old", create);
    pool.end();
    const scene = new Scene();
    scene.add(a, b, old);
    a.position.set(10, 20, 30);
    a.rotation.set(1, 2, 3);
    pool.begin();
    expect(pool.take("junction", create)).toBe(a);
    expect(pool.take("junction", create)).toBe(b);
    pool.end();
    expect(create).toHaveBeenCalledTimes(3);
    expect(a.position.length()).toBe(0);
    expect(a.quaternion.w).toBe(1);
    expect(dispose).toHaveBeenCalledExactlyOnceWith(old);
    expect(old.parent).toBeNull();
    pool.clear();
    expect(dispose).toHaveBeenCalledTimes(3);
  });
});
