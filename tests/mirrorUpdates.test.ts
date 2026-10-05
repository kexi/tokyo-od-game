import { describe, expect, it } from "vitest";
import { Mesh, PerspectiveCamera, PlaneGeometry, WebGLCoordinateSystem, WebGPUCoordinateSystem } from "three";
import { MirrorUpdates } from "../src/game/mirrorUpdates";

const mirror = (x = 0, z = -1) => {
  const mesh = new Mesh(new PlaneGeometry(0.2, 0.1));
  mesh.position.set(x, 0, z);
  return mesh;
};

describe("mirror update slots", () => {
  it("keeps visible mirrors at one update per three frames, skipping hidden slots", () => {
    const scheduler = new MirrorUpdates();
    const camera = new PerspectiveCamera(60, 1, 0.02, 30);
    const surfaces = [mirror(), mirror(10), mirror(-10)];
    expect(Array.from({ length: 6 }, () => scheduler.next(surfaces, camera))).toEqual([
      0,
      null,
      null,
      0,
      null,
      null,
    ]);
  });

  it("serves all newly visible mirrors, one per frame, before returning to regular slots", () => {
    const scheduler = new MirrorUpdates();
    const camera = new PerspectiveCamera(60, 1, 0.02, 30);
    const surfaces = [mirror(), mirror(10), mirror(-10)];
    expect(scheduler.next(surfaces, camera)).toBe(0);
    expect(scheduler.next(surfaces, camera)).toBeNull();
    surfaces[1].position.x = 0;
    expect(scheduler.next(surfaces, camera)).toBe(1);
    surfaces[1].position.x = 10;
    scheduler.next(surfaces, camera);
    surfaces[1].position.x = 0;
    surfaces[2].position.x = 0;
    expect(scheduler.next(surfaces, camera)).toBe(1);
    expect(scheduler.next(surfaces, camera)).toBe(2);
    expect(scheduler.next(surfaces, camera)).toBe(0);
  });

  it("refreshes the visible mirror immediately when returning to the cockpit", () => {
    const scheduler = new MirrorUpdates();
    const camera = new PerspectiveCamera(60, 1, 0.02, 30);
    const surfaces = [mirror(10), mirror(-10), mirror()];
    expect(scheduler.next(surfaces, camera)).toBe(2);
    expect(scheduler.next(surfaces, camera)).toBeNull();
    scheduler.reset();
    expect(scheduler.next(surfaces, camera)).toBe(2);
  });

  for (const coordinateSystem of [WebGLCoordinateSystem, WebGPUCoordinateSystem]) {
    for (const reversed of [false, true]) {
      it(`uses the interior near plane and keeps partially visible mirrors (${coordinateSystem}, reversed=${reversed})`, () => {
        const scheduler = new MirrorUpdates();
        const camera = new PerspectiveCamera(90, 1, 0.02, 30);
        camera.coordinateSystem = coordinateSystem;
        Reflect.set(camera, "_reversedDepth", reversed);
        camera.updateProjectionMatrix();
        const surfaces = [mirror(0, -0.2), mirror(1.05), mirror(0, 1)];
        expect(scheduler.next(surfaces, camera)).toBe(0);
        expect(scheduler.next(surfaces, camera)).toBe(1);
        expect(scheduler.next(surfaces, camera)).toBeNull();
      });
    }
  }

  it("does no work without mirrors or when looking away", () => {
    const scheduler = new MirrorUpdates();
    const camera = new PerspectiveCamera(60, 1, 0.02, 30);
    expect(scheduler.next([], camera)).toBeNull();
    camera.rotation.y = Math.PI;
    camera.updateMatrixWorld();
    expect(scheduler.next([mirror()], camera)).toBeNull();
  });
});
