import type RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3, type Matrix4 } from "three";

/** A floating origin is a rigid transform; rebuilding a trimesh repeats its expensive BVH build. */
export function reanchorCollider(collider: RAPIER.Collider, matrix: Matrix4, rotation: Quaternion): void {
  const p = collider.translation();
  const q = collider.rotation();
  collider.setTranslation(new Vector3(p.x, p.y, p.z).applyMatrix4(matrix));
  collider.setRotation(new Quaternion(q.x, q.y, q.z, q.w).premultiply(rotation));
}

export function reanchorBody(body: RAPIER.RigidBody, matrix: Matrix4, rotation: Quaternion): void {
  const p = body.translation();
  const q = body.rotation();
  body.setTranslation(new Vector3(p.x, p.y, p.z).applyMatrix4(matrix), false);
  body.setRotation(new Quaternion(q.x, q.y, q.z, q.w).premultiply(rotation), false);
}
