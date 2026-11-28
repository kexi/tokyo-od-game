import type { Scene } from "three";

/** Draw synchronous views of the same pose with one scene-wide matrix update. */
export function withSceneMatrices(scene: Scene, draw: () => void): void {
  const shouldUpdate = scene.matrixWorldAutoUpdate;
  if (shouldUpdate) scene.updateMatrixWorld();
  // A frame-wide cache would also suppress later witness renders after their poses change.
  scene.matrixWorldAutoUpdate = false;
  try {
    draw();
  } finally {
    scene.matrixWorldAutoUpdate = shouldUpdate;
  }
}
