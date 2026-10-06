import { Mesh, type Object3D } from "three";

/**
 * A rigid human part keeps its geometry/material and copies the independently moving object.
 * Why not Object3D.clone for plain meshes: it constructs an empty geometry and default material
 * before Mesh.copy immediately replaces both with the template's shared resources.
 */
export function cloneHumanPart(source: Object3D): Object3D {
  const isPlainMesh = source instanceof Mesh && source.constructor === Mesh;
  const copy = isPlainMesh
    ? new Mesh(source.geometry, source.material).copy(source, false)
    : source.clone(false);
  for (const child of source.children) copy.add(cloneHumanPart(child));
  return copy;
}
