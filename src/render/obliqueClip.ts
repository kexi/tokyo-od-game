import { type CoordinateSystem, type Matrix4, Vector4, WebGPUCoordinateSystem } from "three";

/** Normalised-device depth at the near and the far plane for a projection's conventions. */
export type DepthRange = { near: number; far: number };

/**
 * three's conventions (Matrix4.makePerspective): a reversed depth maps near → 1 and far → 0 on both
 * backends; otherwise WebGPU's clip space is 0 … 1 and WebGL's −1 … 1.
 */
export function depthRange(coordinateSystem: CoordinateSystem, isReversed: boolean): DepthRange {
  if (isReversed) return { near: 1, far: 0 };
  return coordinateSystem === WebGPUCoordinateSystem ? { near: 0, far: 1 } : { near: -1, far: 1 };
}

/**
 * Replace a perspective projection's near plane by `plane` (camera space: xyz the normal, w the
 * constant; the positive side is kept), in place: Lengyel's oblique near-plane clipping ("Oblique
 * View Frustum Depth Projection and Clipping", 2005), for any depth range. The far plane is tilted to
 * pass through the frustum's far corner on the plane's side, so depth stays within the range.
 *
 * How: with n, f the range's ends and s = sign(f − n), the near plane is s·(row₃ − n·row₄) ≥ 0;
 * setting row₃ = n·row₄ + s·a·C makes it a·C ≥ 0. The far plane s·(f·row₄ − row₃) = 0 passing through
 * the corner Q (in clip space (sgn Cx, sgn Cy, f, 1)) gives a = |f − n|·(row₄·Q) / (C·Q). For WebGL's
 * −1 … 1 this is Lengyel's own formula.
 */
export function clipNearTo(projection: Matrix4, plane: Vector4, range: DepthRange): void {
  const e = projection.elements;
  const inverse = projection.clone().invert();
  // The plane in clip space: (M⁻¹)ᵀ·C.
  const inClip = plane.clone().applyMatrix4(inverse.clone().transpose());
  const corner = new Vector4(Math.sign(inClip.x), Math.sign(inClip.y), range.far, 1).applyMatrix4(inverse);
  const row4 = new Vector4(e[3], e[7], e[11], e[15]);
  const a = (Math.abs(range.far - range.near) * row4.dot(corner)) / plane.dot(corner);
  const s = Math.sign(range.far - range.near);
  // Column-major: row 3 is elements 2, 6, 10, 14.
  e[2] = range.near * row4.x + s * a * plane.x;
  e[6] = range.near * row4.y + s * a * plane.y;
  e[10] = range.near * row4.z + s * a * plane.z;
  e[14] = range.near * row4.w + s * a * plane.w;
}
