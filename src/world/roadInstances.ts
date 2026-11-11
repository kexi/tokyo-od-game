import { InstancedMesh, type BufferGeometry, type Material, type Matrix4 } from "three";

/** Retain instance identities: WebGPU's node builder cache includes an InstancedMesh's UUID. */
export class RoadInstances {
  private entries: Array<{ mesh: InstancedMesh; used: boolean }> = [];

  begin(): void {
    for (const entry of this.entries) {
      entry.used = false;
      entry.mesh.visible = false;
    }
  }

  reanchor(matrix: Matrix4): void {
    for (const { mesh } of this.entries) mesh.applyMatrix4(matrix);
  }

  /**
   * A mesh of `geometry` and `material` for `count` instances. `prepare` runs on it before it is
   * returned, made or reused (the sign faces give it their per-instance attribute there, before
   * anything can draw it).
   */
  take(
    geometry: BufferGeometry,
    material: Material,
    count: number,
    prepare?: (mesh: InstancedMesh) => void,
  ): InstancedMesh {
    let entry = this.entries.find(
      (e) => !e.used && e.mesh.geometry === geometry && e.mesh.material === material,
    );
    const mustGrow = entry && entry.mesh.instanceMatrix.count < count;
    if (entry && mustGrow) {
      entry.mesh.removeFromParent();
      entry.mesh.dispose();
      this.entries.splice(this.entries.indexOf(entry), 1);
      entry = undefined;
    }
    if (!entry) {
      const capacity = 2 ** Math.ceil(Math.log2(Math.max(1, count)));
      entry = { mesh: new InstancedMesh(geometry, material, capacity), used: false };
      this.entries.push(entry);
    }
    entry.used = true;
    const mesh = entry.mesh;
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    mesh.visible = true;
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.boundingBox = null;
    mesh.boundingSphere = null;
    prepare?.(mesh);
    return mesh;
  }

  end(): void {
    for (const entry of this.entries) {
      if (entry.used) continue;
      entry.mesh.removeFromParent();
      entry.mesh.dispose();
    }
    this.entries = this.entries.filter((e) => e.used);
  }

  clear(): void {
    this.begin();
    this.end();
  }
}
