import type { Node } from "three/webgpu";
import { dot, float, floor, fract, mix, select, vec2, vec3 } from "three/tsl";

/**
 * Small TSL helpers shared by the surface materials (façades, streets).
 * Plain expressions (no statements), so they can be used in any node slot, inside or outside Fn.
 */

/**
 * Dave Hoskins' hash12 ("hash without sine"): stable at world coordinates of a few km, 0 ≤ h < 1.
 * Same arithmetic as facadeHash in world/facade.ts, which the tests check.
 */
/**
 * The brightest value a pass may write into the frame's half-float target (largest finite half:
 * 65504). The sky's sun disc is already near it (skyShader.ts SKY_MAX); a pass that adds light on
 * top (the bloom, the lens flare) would overflow to Inf, which the tone mapping turns into NaN —
 * black — and the bloom's coarse levels spread into a square. Clamped where light is added.
 */
export const HALF_MAX = 65000;

export function hash12(p: Node<"vec2">): Node<"float"> {
  const q = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  const r = q.add(dot(q, vec3(q.y, q.z, q.x).add(33.33)));
  return fract(r.x.add(r.y).mul(r.z));
}

/** Smooth value noise on the unit lattice (hash12 at the corners, smoothstep blend). */
export function valueNoise(p: Node<"vec2">): Node<"float"> {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const a = hash12(i);
  const b = hash12(i.add(vec2(1, 0)));
  const c = hash12(i.add(vec2(0, 1)));
  const d = hash12(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/**
 * values[index] for a small whole-number index held in a float (a table lookup without an array
 * in the shader): a chain of selects, the last value for anything past the end.
 * Why not a const array indexed in WGSL: TSL has no typed const arrays, and the tables have 5–8
 * entries, so a few selects cost less than a uniform buffer read.
 */
export function byIndex(index: Node<"float">, values: readonly number[]): Node<"float"> {
  let out: Node<"float"> = float(values[values.length - 1]);
  for (let i = values.length - 2; i >= 0; i--) out = select(index.lessThan(i + 0.5), float(values[i]), out);
  return out;
}
