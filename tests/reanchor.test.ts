import RAPIER from "@dimforge/rapier3d-compat";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { reanchorBody, reanchorCollider } from "../src/physics/reanchor";

beforeAll(() => RAPIER.init());

describe("floating origin colliders", () => {
  it("preserves trimesh identity and ground hits over successive translations and rotations", () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    try {
      const collider = world.createCollider(
        RAPIER.ColliderDesc.trimesh(
          new Float32Array([-20, 2, -20, 20, 2, -20, 20, 2, 20, -20, 2, 20]),
          new Uint32Array([0, 2, 1, 0, 3, 2]),
        ),
      );
      const handle = collider.handle;
      const vertices = Array.from(collider.vertices());
      const point = new Vector3(3, 2, -4);
      const up = new Vector3(0, 1, 0);
      for (const distance of [0, 500, -800]) {
        const rotation = new Quaternion().setFromEuler(new Euler(0.0003, 0.2, 0.0002));
        const matrix = new Matrix4().compose(new Vector3(distance, -10, 240), rotation, new Vector3(1, 1, 1));
        point.applyMatrix4(matrix);
        up.applyQuaternion(rotation);
        reanchorCollider(collider, matrix, rotation);
        world.step();
        const origin = point.clone().addScaledVector(up, 30);
        const ray = new RAPIER.Ray(origin, up.clone().negate());
        const hit = world.castRay(ray, 60, true);
        expect(hit?.collider.handle).toBe(handle);
        expect(hit?.timeOfImpact).toBeCloseTo(30, 3);
        expect(collider.handle).toBe(handle);
        expect(Array.from(collider.vertices())).toEqual(vertices);
      }
    } finally {
      world.free();
    }
  });

  it("moves all colliders of a fixed body without replacing their handles or relative placements", () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    try {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(5, 2, 7));
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(1, 2, 3).setTranslation(4, 0, 0),
        body,
      );
      const old = collider.translation();
      const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3);
      const matrix = new Matrix4().compose(new Vector3(-500, 3, 100), rotation, new Vector3(1, 1, 1));
      const expected = new Vector3(old.x, old.y, old.z).applyMatrix4(matrix);
      reanchorBody(body, matrix, rotation);
      world.step();
      const actual = collider.translation();
      expect(new Vector3(actual.x, actual.y, actual.z).distanceTo(expected)).toBeLessThan(0.001);
      expect(body.collider(0).handle).toBe(collider.handle);
      expect(collider.translationWrtParent()).toEqual({ x: 4, y: 0, z: 0 });
    } finally {
      world.free();
    }
  });
});
