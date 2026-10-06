import RAPIER from "@dimforge/rapier3d-compat";

export type ColliderMesh = {
  vertices: Float32Array;
  indices: Uint32Array;
  flags?: RAPIER.TriMeshFlags;
};
export type ColliderSnapshot = { bytes: Uint8Array; handle: number };
export type PreparedCollider = { mesh: ColliderMesh; snapshot: ColliderSnapshot | null };

/** The scratch world contains one fixed shape; its serialized BVH survives restoration. */
export function snapshotCollider(mesh: ColliderMesh): ColliderSnapshot {
  const scratch = new RAPIER.World({ x: 0, y: 0, z: 0 });
  try {
    const collider = scratch.createCollider(
      RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices, mesh.flags),
    );
    return { bytes: scratch.takeSnapshot(), handle: collider.handle };
  } finally {
    scratch.free();
  }
}

/** Register a prepared BVH without changing the target world's bodies, joints or queries. */
export function installCollider(
  world: RAPIER.World,
  prepared: PreparedCollider,
  friction: number,
): RAPIER.Collider {
  const { mesh, snapshot } = prepared;
  const desc = RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices, mesh.flags).setFriction(friction);
  const hasSnapshot = snapshot !== null;
  if (!hasSnapshot) return world.createCollider(desc);
  const scratch = RAPIER.World.restoreSnapshot(snapshot.bytes);
  const intoRaw = desc.shape.intoRaw;
  // Shape.intoRaw normally rebuilds the BVH from vertices. coShape clones the restored shared shape.
  // Restore the method before returning: later shape queries must not depend on the scratch world.
  desc.shape.intoRaw = () => scratch.colliders.raw.coShape(snapshot.handle);
  try {
    return world.createCollider(desc);
  } finally {
    desc.shape.intoRaw = intoRaw;
    scratch.free();
  }
}
