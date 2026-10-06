import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  type Camera,
  type Object3D,
  type Scene,
} from "three";
import { facadeMaterial } from "./facade";
import { prepareBuildingShaders } from "./buildingShaders";

type Compiler = {
  compileAsync?(object: Object3D, camera: Camera, targetScene?: Scene | null): Promise<unknown>;
};

/** Keep the two surveyed PLATEAU layout variants warm even after their last actual tile is evicted. */
export class FacadeShaderLayouts {
  private readonly group = new Group();
  private readonly meshes: Mesh[] = [];
  private versions: number[] = [];
  private pending: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly camera: Camera,
    private readonly scene: Scene,
    private readonly renderer: Compiler,
  ) {
    for (const feature of [false, true]) {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
      geometry.setAttribute("normal", new BufferAttribute(new Float32Array(9), 3));
      geometry.setAttribute("facade", new BufferAttribute(new Float32Array(6), 2));
      geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2]), 1));
      if (feature) {
        const ids = new InterleavedBuffer(new Uint16Array(6), 2);
        geometry.setAttribute("_feature_id_0", new InterleavedBufferAttribute(ids, 1, 0));
      } else {
        geometry.setAttribute("_batchid", new BufferAttribute(new Float32Array(3), 1));
      }
      const mesh = new Mesh(geometry, facadeMaterial());
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  async prepare(): Promise<void> {
    const isDisposed = this.disposed;
    if (isDisposed) return;
    const isPending = this.pending !== null;
    if (isPending) return this.pending!;
    const unchanged = this.meshes.every((mesh, i) => {
      const material = mesh.material as ReturnType<typeof facadeMaterial>;
      return material.version === this.versions[i];
    });
    if (unchanged) return;
    this.pending = this.prepareLayouts();
    try {
      await this.pending;
    } finally {
      this.pending = null;
    }
  }

  private async prepareLayouts(): Promise<void> {
    try {
      await prepareBuildingShaders(this.group, this.camera, this.scene, this.renderer);
      this.versions = this.meshes.map((mesh) => (mesh.material as ReturnType<typeof facadeMaterial>).version);
    } finally {
      // Vertex buffers are unnecessary after compilation; material disposal would evict the retained shader state.
      for (const mesh of this.meshes) mesh.geometry.dispose();
      const wasDisposed = this.disposed;
      if (wasDisposed) this.releaseMaterials();
    }
  }

  private releaseMaterials(): void {
    for (const mesh of this.meshes) (mesh.material as ReturnType<typeof facadeMaterial>).dispose();
  }

  dispose(): void {
    const wasDisposed = this.disposed;
    if (wasDisposed) return;
    this.disposed = true;
    const isPending = this.pending !== null;
    if (!isPending) this.releaseMaterials();
  }
}
