import type { Mesh } from "three";

/** Text plates retain their meshes and materials while their content remains in the road window. */
export class RoadPlates {
  private entries: Array<{ key: string; mesh: Mesh; used: boolean }> = [];

  constructor(private readonly dispose: (mesh: Mesh) => void) {}

  begin(): void {
    for (const entry of this.entries) {
      entry.used = false;
      entry.mesh.removeFromParent();
    }
  }

  take(key: string, create: () => Mesh): Mesh {
    let entry = this.entries.find((e) => !e.used && e.key === key);
    if (!entry) {
      entry = { key, mesh: create(), used: false };
      this.entries.push(entry);
    }
    entry.used = true;
    entry.mesh.visible = true;
    entry.mesh.position.set(0, 0, 0);
    entry.mesh.quaternion.identity();
    entry.mesh.scale.set(1, 1, 1);
    return entry.mesh;
  }

  end(): void {
    for (const entry of this.entries) {
      if (entry.used) continue;
      entry.mesh.removeFromParent();
      this.dispose(entry.mesh);
    }
    this.entries = this.entries.filter((e) => e.used);
  }

  clear(): void {
    this.begin();
    this.end();
  }
}
