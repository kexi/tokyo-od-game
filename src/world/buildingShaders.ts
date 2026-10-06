import { Mesh, type Camera, type Object3D, type Scene } from "three";

type Compiler = {
  compileAsync?(object: Object3D, camera: Camera, targetScene?: Scene | null): Promise<unknown>;
};

/** Prepare the actual tile's shaders before its ECEF scene is exposed by the tile loader. */
export async function prepareBuildingShaders(
  object: Object3D,
  camera: Camera,
  scene: Scene,
  renderer: Compiler,
): Promise<void> {
  const hasCompiler = typeof renderer.compileAsync === "function";
  if (!hasCompiler) return;
  const meshes: Mesh[] = [];
  object.traverse((item) => {
    const isMesh = item instanceof Mesh;
    if (isMesh) meshes.push(item);
  });
  const culling = meshes.map((mesh) => mesh.frustumCulled);
  // The parser has not attached the ECEF model under the floating-origin group yet.
  for (const mesh of meshes) mesh.frustumCulled = false;
  try {
    for (;;) {
      const materials = meshes.flatMap((mesh) =>
        Array.isArray(mesh.material) ? mesh.material : [mesh.material],
      );
      const versions = materials.map((material) => material.version);
      await renderer.compileAsync!(object, camera, scene);
      const changed = materials.some((material, i) => material.version !== versions[i]);
      if (!changed) return;
    }
  } finally {
    meshes.forEach((mesh, i) => {
      mesh.frustumCulled = culling[i];
    });
  }
}
