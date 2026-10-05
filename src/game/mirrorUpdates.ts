import { Frustum, Matrix4, type Camera, type Mesh } from "three";

/** Keeps each mirror's original update slot; newly visible mirrors get the next free turn. */
export class MirrorUpdates {
  private readonly frustum = new Frustum();
  private readonly projection = new Matrix4();
  private readonly seen = new Set<number>();
  private readonly pending = new Set<number>();
  private turn = 0;

  reset(): void {
    this.seen.clear();
    this.pending.clear();
    this.turn = 0;
  }

  next(surfaces: readonly Mesh[], camera: Camera): number | null {
    const count = surfaces.length;
    const isEmpty = count === 0;
    if (isEmpty) return null;
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection, camera.coordinateSystem, camera.reversedDepth);
    for (let i = 0; i < count; i++) {
      const surface = surfaces[i];
      surface.updateWorldMatrix(true, false);
      const isVisible = surface.visible && this.frustum.intersectsObject(surface);
      if (!isVisible) {
        this.seen.delete(i);
        this.pending.delete(i);
        continue;
      }
      const isNewlyVisible = !this.seen.has(i);
      if (isNewlyVisible) this.pending.add(i);
      this.seen.add(i);
    }
    const slot = this.turn;
    this.turn = (this.turn + 1) % count;
    // Skipping a hidden slot must not turn the remaining mirror into a full-rate scene render.
    for (let offset = 0; offset < count; offset++) {
      const i = (slot + offset) % count;
      const isPending = this.pending.has(i);
      if (!isPending) continue;
      this.pending.delete(i);
      return i;
    }
    return this.seen.has(slot) ? slot : null;
  }
}
