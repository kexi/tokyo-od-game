import {
  InstancedMesh,
  type Camera,
  type Material,
  type Object3D,
  type RenderTarget,
  type Scene,
} from "three";
import { log, newSpan, warn } from "../log";

type Compiler = {
  compileAsync?(object: Object3D, camera: Camera, targetScene?: Scene | null): Promise<unknown>;
  hasInitialized?(): boolean;
  getRenderTarget(): RenderTarget | null;
  setRenderTarget(target: RenderTarget | null, cubeFace?: number, mipmapLevel?: number): void;
  getActiveCubeFace?(): number;
  getActiveMipmapLevel?(): number;
};

type Prepared = { materials: Material[]; versions: number[]; color: InstancedMesh["instanceColor"] };

function matches(mesh: InstancedMesh, state: Prepared | undefined): boolean {
  const hasState = state !== undefined;
  if (!hasState || mesh.instanceColor !== state.color) return false;
  const materials = mesh.material;
  const isArray = Array.isArray(materials);
  const length = isArray ? materials.length : 1;
  const sameLength = length === state.materials.length;
  if (!sameLength) return false;
  for (let i = 0; i < length; i++) {
    const material = isArray ? materials[i] : materials;
    const unchanged = material === state.materials[i] && material.version === state.versions[i];
    if (!unchanged) return false;
  }
  return true;
}

/** Prepare the actual streamed instance identities before a frame can build their shaders synchronously. */
export class StreamedInstanceShaders {
  private readonly prepared = new WeakMap<InstancedMesh, Prepared>();
  private readonly failed = new WeakSet<InstancedMesh>();

  constructor(
    private readonly renderer: Compiler,
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly target: RenderTarget,
  ) {}

  async prepare(): Promise<void> {
    const hasCompiler = typeof this.renderer.compileAsync === "function";
    const isInitialized = this.renderer.hasInitialized?.() !== false;
    if (!hasCompiler || !isInitialized) return;
    const pending: Array<{
      mesh: InstancedMesh;
      culling: boolean;
      disposed: boolean;
      onDispose: () => void;
    }> = [];
    for (const child of this.scene.children) {
      const isNewInstance =
        child instanceof InstancedMesh &&
        child.visible &&
        child.count > 0 &&
        !this.failed.has(child) &&
        !matches(child, this.prepared.get(child));
      if (!isNewInstance) continue;
      const mesh = child as InstancedMesh;
      const entry = {
        mesh,
        culling: mesh.frustumCulled,
        disposed: false,
        onDispose: () => {
          entry.disposed = true;
        },
      };
      pending.push(entry);
      mesh.addEventListener("dispose", entry.onDispose);
      // Hide the whole batch before awaiting: otherwise a frame could draw the later objects early.
      mesh.visible = false;
    }
    const hasPending = pending.length > 0;
    if (!hasPending) return;
    const started = performance.now();
    const span = newSpan("streamed_shaders");
    let prepared = 0;
    try {
      for (const entry of pending) {
        const { mesh } = entry;
        for (;;) {
          const isCurrent = mesh.parent === this.scene && !entry.disposed && mesh.count > 0;
          if (!isCurrent) break;
          const materials = Array.isArray(mesh.material) ? mesh.material.slice() : [mesh.material];
          const state: Prepared = {
            materials,
            versions: materials.map((material) => material.version),
            color: mesh.instanceColor,
          };
          const previousTarget = this.renderer.getRenderTarget();
          const previousFace = this.renderer.getActiveCubeFace?.() ?? 0;
          const previousLevel = this.renderer.getActiveMipmapLevel?.() ?? 0;
          try {
            let compilation: Promise<unknown>;
            try {
              mesh.visible = true;
              mesh.frustumCulled = false;
              this.renderer.setRenderTarget(this.target);
              // An initialized renderer collects this object synchronously; never leave global draw state changed across an await.
              compilation = this.renderer.compileAsync!(mesh, this.camera, this.scene);
            } finally {
              mesh.visible = false;
              mesh.frustumCulled = entry.culling;
              this.renderer.setRenderTarget(previousTarget, previousFace, previousLevel);
            }
            await compilation;
            const unchanged = matches(mesh, state);
            if (!unchanged) continue;
            const stillCurrent = mesh.parent === this.scene && !entry.disposed;
            if (stillCurrent) {
              this.prepared.set(mesh, state);
              mesh.visible = true;
              prepared++;
            }
            break;
          } catch (error) {
            this.failed.add(mesh);
            warn("streamed_shader_failed", { meshId: mesh.uuid, error: String(error) }, span);
            break;
          }
        }
      }
    } finally {
      for (const entry of pending) {
        entry.mesh.removeEventListener("dispose", entry.onDispose);
        entry.mesh.frustumCulled = entry.culling;
        const stillCurrent = entry.mesh.parent === this.scene && !entry.disposed;
        if (stillCurrent) entry.mesh.visible = true;
        // A dispose during compilation precedes allocation of some instance buffers; release those too.
        if (entry.disposed) entry.mesh.dispose();
      }
    }
    log("streamed_shaders_prepared", { meshes: prepared, durationMs: performance.now() - started }, span);
  }
}
