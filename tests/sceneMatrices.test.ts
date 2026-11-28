import { describe, expect, it, vi } from "vitest";
import { Group, Matrix4, Object3D, Scene, Vector3 } from "three";
import { withSceneMatrices } from "../src/render/sceneMatrices";

/** The renderer's scene update, before drawing a camera's view. */
function drawView(scene: Scene): void {
  const shouldUpdate = scene.matrixWorldAutoUpdate;
  if (shouldUpdate) scene.updateMatrixWorld();
}

describe("scene matrices across synchronous views", () => {
  it("uses the current hierarchy for every view with one scene-wide update", () => {
    const scene = new Scene();
    const car = new Group();
    const blade = new Object3D();
    scene.add(car);
    car.add(blade);
    car.position.set(10, 2, -5);
    car.rotation.y = 0.5;
    blade.position.set(1, 0, 2);
    blade.rotation.z = 0.3;
    const expected = scene.clone();
    expected.updateMatrixWorld();
    const update = vi.spyOn(scene, "updateMatrixWorld");
    withSceneMatrices(scene, () => {
      for (let view = 0; view < 4; view++) {
        drawView(scene);
        expect(blade.matrixWorld.elements).toEqual(expected.children[0].children[0].matrixWorld.elements);
      }
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(scene.matrixWorldAutoUpdate).toBe(true);
  });

  it("updates changed poses, new children and origin transforms in the next scope", () => {
    const scene = new Scene();
    const origin = new Group();
    const actor = new Object3D();
    scene.add(origin);
    origin.add(actor);
    withSceneMatrices(scene, () => drawView(scene));
    origin.matrixAutoUpdate = false;
    origin.matrix.makeTranslation(-4000, 0, 3000);
    origin.matrixWorldNeedsUpdate = true;
    actor.position.set(4001, 2, -3003);
    const loaded = new Object3D();
    loaded.position.set(4005, 4, -3007);
    origin.add(loaded);
    withSceneMatrices(scene, () => {
      drawView(scene);
      expect(new Vector3().setFromMatrixPosition(actor.matrixWorld).toArray()).toEqual([1, 2, -3]);
      expect(new Vector3().setFromMatrixPosition(loaded.matrixWorld).toArray()).toEqual([5, 4, -7]);
    });
  });

  it("restores automatic updates before a later witness pose is drawn in the same task", () => {
    const scene = new Scene();
    const actor = new Object3D();
    scene.add(actor);
    actor.position.x = 1;
    withSceneMatrices(scene, () => drawView(scene));
    actor.position.x = 7;
    drawView(scene);
    expect(actor.matrixWorld.elements[12]).toBe(7);
  });

  it("retains a caller's manual matrix ownership", () => {
    const scene = new Scene();
    scene.matrixWorldAutoUpdate = false;
    scene.matrixWorld.copy(new Matrix4().makeTranslation(1, 2, 3));
    scene.position.set(10, 20, 30);
    const update = vi.spyOn(scene, "updateMatrixWorld");
    withSceneMatrices(scene, () => {
      drawView(scene);
      expect(new Vector3().setFromMatrixPosition(scene.matrixWorld).toArray()).toEqual([1, 2, 3]);
    });
    expect(update).not.toHaveBeenCalled();
    expect(scene.matrixWorldAutoUpdate).toBe(false);
  });

  it("keeps nested views in the same pose and restores the outer ownership", () => {
    const scene = new Scene();
    const update = vi.spyOn(scene, "updateMatrixWorld");
    withSceneMatrices(scene, () => {
      withSceneMatrices(scene, () => drawView(scene));
      expect(scene.matrixWorldAutoUpdate).toBe(false);
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(scene.matrixWorldAutoUpdate).toBe(true);
  });

  it("restores scene updates when a renderer throws", () => {
    const scene = new Scene();
    const failure = new Error("draw failed");
    expect(() =>
      withSceneMatrices(scene, () => {
        throw failure;
      }),
    ).toThrow(failure);
    expect(scene.matrixWorldAutoUpdate).toBe(true);
    drawView(scene);
  });
});
