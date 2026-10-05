import { describe, expect, it } from "vitest";
import {
  type CoordinateSystem,
  PerspectiveCamera,
  Plane,
  Vector3,
  Vector4,
  WebGLCoordinateSystem,
  WebGPUCoordinateSystem,
} from "three";
import { clipNearTo, depthRange } from "../src/render/obliqueClip";

const CASES: Array<[string, CoordinateSystem, boolean]> = [
  ["WebGL −1…1", WebGLCoordinateSystem, false],
  ["WebGPU 0…1", WebGPUCoordinateSystem, false],
  ["reversed 1…0", WebGPUCoordinateSystem, true],
  ["reversed on WebGL 2 (clip control)", WebGLCoordinateSystem, true],
];

/** A water mirror's camera: 10 m below the water (y = 0), looking up the reflected view. */
function mirrorCamera(coordinateSystem: CoordinateSystem, isReversed: boolean) {
  const camera = new PerspectiveCamera(60, 1.5, 0.5, 1800);
  camera.coordinateSystem = coordinateSystem;
  Reflect.set(camera, "_reversedDepth", isReversed);
  camera.position.set(0, -10, 0);
  camera.lookAt(0, 5, -60);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

const ndc = (camera: PerspectiveCamera, p: Vector3) => {
  const v = new Vector4(p.x, p.y, p.z, 1)
    .applyMatrix4(camera.matrixWorldInverse)
    .applyMatrix4(camera.projectionMatrix);
  return { x: v.x / v.w, y: v.y / v.w, z: v.z / v.w, w: v.w };
};

describe("the oblique near plane (Lengyel) in every depth convention", () => {
  for (const [name, cs, isReversed] of CASES) {
    it(`clips at the water and keeps what is above it (${name})`, () => {
      const camera = mirrorCamera(cs, isReversed);
      const plain = camera.projectionMatrix.clone();
      const range = depthRange(cs, isReversed);
      const water = new Plane(new Vector3(0, 1, 0), 0).applyMatrix4(camera.matrixWorldInverse);
      clipNearTo(
        camera.projectionMatrix,
        new Vector4(water.normal.x, water.normal.y, water.normal.z, water.constant),
        range,
      );
      const toward = Math.sign(range.far - range.near);
      const inRange = (z: number) => (z - range.near) * toward >= -1e-6 && (range.far - z) * toward >= -1e-6;
      // Above the water and in view: drawn, at a depth inside the range.
      for (const p of [new Vector3(0, 3, -40), new Vector3(5, 20, -300), new Vector3(-8, 1, -1200)]) {
        const q = ndc(camera, p);
        expect(q.w).toBeGreaterThan(0);
        expect(inRange(q.z)).toBe(true);
      }
      // Under the water, in front of the camera: clipped on the near side.
      for (const p of [new Vector3(0, -5, -20), new Vector3(2, -1, -60)]) {
        const q = ndc(camera, p);
        expect(q.w).toBeGreaterThan(0);
        expect((q.z - range.near) * toward).toBeLessThan(0);
      }
      // On the water: at the near plane.
      expect(ndc(camera, new Vector3(0, 0, -30)).z).toBeCloseTo(range.near, 4);
      // The picture itself (x, y) is unchanged.
      const e = camera.projectionMatrix.elements;
      const p = plain.elements;
      for (const i of [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15]) expect(e[i]).toBeCloseTo(p[i], 9);
    });
  }

  it("knows three's depth ranges", () => {
    expect(depthRange(WebGLCoordinateSystem, false)).toEqual({ near: -1, far: 1 });
    expect(depthRange(WebGPUCoordinateSystem, false)).toEqual({ near: 0, far: 1 });
    expect(depthRange(WebGPUCoordinateSystem, true)).toEqual({ near: 1, far: 0 });
  });
});
