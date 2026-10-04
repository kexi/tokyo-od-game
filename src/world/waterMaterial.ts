import { Color, HalfFloatType, Matrix4, RenderTarget, Vector3 } from "three";
import { MeshBasicNodeMaterial, type Node, type TextureNode } from "three/webgpu";
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  smoothstep,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

/**
 * Water surface of the rivers, canals and the bay.
 * - Ripples are a few long, low swells plus four octaves of drifting value noise (with their
 *   analytic slopes), each on a rotated grid so no lattice or crest lines line up, all procedural,
 *   so no normal-map texture is shipped. They fade with distance: far water reads as a calmer
 *   mirror and does not shimmer as the pixels undersample it. Rain roughens them (uRough).
 * - Reflection: the planar reflection of the scene (WaterLayer.renderReflection, one render for the
 *   nearest water level, half resolution) where this fragment lies within ~1 m of that level; the sky
 *   (horizon = fog colour, a darker zenith, the sun) elsewhere and on phones.
 * - Fresnel (Schlick, F0 = 0.02 for water): the river's own colour looking down from a bridge, the
 *   reflection at grazing angles. Tokyo's rivers are turbid, a dark green-grey body colour.
 * - Sun glint: a sharp specular lobe along the reflected ray.
 * - The atmospheric fog of atmosphere.ts (the scene's fog node) and the frame's tone mapping, as
 *   every material. The tide raises the tidal vertices (aTidal = 1) by uTide.
 * The TSL port of the WebGL version's GLSL, term for term; the uniforms keep its names and value
 * types (WaterLayer sets them every frame).
 * Why not three's Water (examples/objects/Water.js) or the TSL reflector(): they need a normal-map
 * texture or render their own reflection for every camera that draws them (the mirrors, a
 * bystander's phone), and have no fallback for water at other levels.
 */
export type WaterMaterial = MeshBasicNodeMaterial & {
  uniforms: ReturnType<typeof waterUniforms>;
  /** Kept for WaterLayer, which flags a per-mesh uniform change (node uniforms need no flag). */
  uniformsNeedUpdate: boolean;
};

type F = Node<"float">;
type V2 = Node<"vec2">;
type V3 = Node<"vec3">;

function waterUniforms() {
  return {
    uTime: uniform(0),
    uTide: uniform(0),
    /** The reflection's texture (a texture node: its `value` is the texture). */
    uReflection: texture(new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false }).texture),
    uReflectionOn: uniform(0),
    uReflectionMatrix: uniform(new Matrix4()),
    uPlaneY: uniform(0),
    uSunDir: uniform(new Vector3(0, 1, 0)),
    uSunColor: uniform(new Color(0xffffff)),
    uSunStrength: uniform(1),
    uSkyZenith: uniform(new Color(0x3d6fb0)),
    uSkyHorizon: uniform(new Color(0xbfd2e4)),
    uBody: uniform(new Color(0x1d2a26)),
    uAmbient: uniform(1),
    uRough: uniform(1),
  };
}

// Dave Hoskins' hash12 (without sine).
function hash12(p: V2): F {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}

/** Value noise and its gradient (quintic fade): vec3(n, ∂n/∂x, ∂n/∂y). */
function noised(p: V2): V3 {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f
    .mul(f)
    .mul(f)
    .mul(f.mul(f.mul(6).sub(15)).add(10))
    .toVar();
  const du = f
    .mul(f)
    .mul(f.mul(f.sub(2)).add(1))
    .mul(30);
  const a = hash12(i).toVar();
  const b = hash12(i.add(vec2(1, 0))).toVar();
  const c = hash12(i.add(vec2(0, 1))).toVar();
  const d = hash12(i.add(vec2(1, 1)));
  const k = a.sub(b).sub(c).add(d).toVar();
  const value = a.add(b.sub(a).mul(u.x)).add(c.sub(a).mul(u.y)).add(k.mul(u.x).mul(u.y));
  return vec3(value, du.mul(vec2(b.sub(a), c.sub(a)).add(k.mul(u.yx))));
}

const SWELL_LENGTH = [9.1, 5.3, 3.4, 2.1];
const SWELL_DIRECTION = [0.3, 1.9, -0.8, 2.7];
/** The noise octaves' grid turns by this angle each octave (cos 0.8, sin 0.6). */
const TURN = Math.atan2(0.6, 0.8);

/** Rotate (x, y) by angle a: the GLSL's mat2(0.8, 0.6, −0.6, 0.8) to the power o. */
const rotate = (v: V2, a: number): V2 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return vec2(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)));
};

/**
 * Slope (dh/dx, dh/dz) of the ripples at p (metres), t (s): `swells` long, low swells, then four
 * octaves of value noise. How: the loops unrolled at build time, the rotations as constants.
 */
function ripples(p: V2, t: F, swells: number): V2 {
  let slope: V2 = vec2(0);
  for (let i = 0; i < Math.min(swells, 4); i++) {
    const L = SWELL_LENGTH[i];
    const k = (2 * Math.PI) / L;
    const dir = vec2(Math.cos(SWELL_DIRECTION[i]), Math.sin(SWELL_DIRECTION[i]));
    // Deep-water dispersion: ω = √(g k); slope amplitude ~0.6 % of the wavelength.
    const phase = dot(dir, p)
      .mul(k)
      .sub(t.mul(Math.sqrt(9.81 * k)));
    slope = slope.add(dir.mul(cos(phase).mul(0.006 * L * k)));
  }
  // Octave o samples n(R^o · p · f_o): its slope is f_o · (R^o)ᵀ ∇n.
  let freq = 0.42;
  let amp = 0.07;
  let driftScale = 1;
  const drift0 = vec2(0.31, 0.17).mul(t);
  for (let o = 0; o < 4; o++) {
    const angle = o * TURN;
    const drift = rotate(drift0, angle).mul(driftScale);
    const n = noised(rotate(p, angle).mul(freq).add(drift));
    slope = slope.add(rotate(n.yz, -angle).mul(amp * freq));
    freq *= 2.17;
    driftScale *= 1.35;
    amp *= 0.5;
  }
  return slope;
}

export function createWaterMaterial(waves: number): WaterMaterial {
  const u = waterUniforms();
  const material = new MeshBasicNodeMaterial() as WaterMaterial;
  material.name = "water";
  material.uniforms = u;
  material.uniformsNeedUpdate = false;
  // The tide raises the tidal vertices (aTidal = 1).
  material.positionNode = positionLocal.add(vec3(0, attribute<"float">("aTidal", "float").mul(u.uTide), 0));
  // Projected into the reflection's picture per vertex (the texture matrix includes the mirror's
  // view and projection).
  const vReflect = varying(u.uReflectionMatrix.mul(vec4(positionWorld, 1)));
  const world = positionWorld;
  const toEye = cameraPosition.sub(world);
  const dist = length(toEye).toVar();
  const V = toEye.div(max(dist, 1e-3)).toVar();
  // Calmer with distance (and at grazing angles, where the ripples alias); rougher in rain.
  const fade = u.uRough.div(dist.div(120).add(1));
  const slope = ripples(world.xz, u.uTime, waves).mul(fade).toVar();
  const N = normalize(vec3(slope.x.negate(), 1, slope.y.negate())).toVar();
  const cosV = clamp(dot(N, V), 0, 1);
  const fresnel = pow(cosV.oneMinus(), 5).mul(0.98).add(0.02).toVar();
  const reflected = reflect(V.negate(), N).toVar();
  const R = vec3(reflected.x, abs(reflected.y), reflected.z).toVar();
  const sky = mix(u.uSkyHorizon, u.uSkyZenith, pow(R.y, 0.6));
  const onPlane = u.uReflectionOn.mul(smoothstep(0.5, 1.2, abs(world.y.sub(u.uPlaneY))).oneMinus());
  const uv = vReflect.xy.div(vReflect.w).add(N.xz.mul(float(0.12).div(dist.mul(0.05).add(1))));
  // Sampled whatever onPlane is (the WebGL version branched; a sample with an implicit level must
  // stay out of a data-dependent branch in WGSL), at level 0: the target has no mips.
  const planar = (u.uReflection as TextureNode).sample(clamp(uv, 0.001, 0.999)).level(float(0)).rgb;
  const mirrored = mix(sky, planar, onPlane);
  const body = u.uBody.mul(u.uAmbient);
  const sun = max(dot(R, u.uSunDir), 0).toVar();
  const glint = pow(sun, 600).mul(60).add(pow(sun, 60).mul(0.6));
  material.colorNode = mix(body, mirrored, fresnel).add(
    u.uSunColor.mul(glint.mul(u.uSunStrength).mul(fresnel)),
  );
  return material;
}
