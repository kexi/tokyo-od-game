import { type Fog, Vector3, Vector4 } from "three";
import type { Node } from "three/webgpu";
import {
  abs,
  cameraPosition,
  dot,
  exp,
  float,
  fog,
  length,
  max,
  output,
  positionWorld,
  pow,
  rangeFogFactor,
  reference,
  renderGroup,
  select,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";

/**
 * Depth fog as the air does it, for every material with `fog` on (the scene's fogNode):
 * - Extinction follows Beer–Lambert, 1 − exp(−τ), with τ the optical depth along the view ray, so
 *   near things keep their contrast and the haze builds up with distance instead of a wall.
 * - The air thins with height (density σ₀·exp(−h/H)): τ is integrated along the ray, so the tops of
 *   towers stand out of the haze that swallows the streets at the same distance.
 * - σ₀ comes from the meteorological visibility V (Koschmieder: V = 3.912 / σ₀, the distance at which
 *   a black object's contrast falls to 2%).
 * - Looking towards the sun the haze glows (forward Mie scattering): a warm lobe around the sun.
 * - The fog colour is a radiance like the lit surfaces (the same value the water reflects as its
 *   horizon). Node materials mix the fog in linear light and the frame is tone-mapped once at the
 *   end (render/frame.ts), so the haze is tone-mapped exactly as the surface it veils. (The WebGL
 *   version tone-mapped the fog colour inside the chunk, because three's chunk ran after the
 *   surface's tone mapping; the sky's horizon haze, skyShader.ts, is mixed the same way as here.)
 * - A light much brighter than the haze around it keeps LIGHT_FLOOR of its radiance however far it
 *   is (lightsThrough): a floodlit tower in the rain at night, a lamp across the bay.
 * The old linear ramp (fogNear → fogFar) stays as a floor at the edge of the drawn world (the far
 * ground's reach, farGround.ts), so its end never shows. It used to sit at 2–4 km, the end of the
 * streamed tiles, where it painted the city fog-coloured in front of the far towers and their feet
 * vanished into it: the towers seemed to float.
 *
 * Why not three's FogExp2: exp(−(ρd)²) is not how light is attenuated (it keeps the near field too
 * clean and then closes abruptly) and it has no height or sun. Why not a post-process depth pass:
 * it would need a depth texture of the whole frame and could not tell sky from far geometry; doing
 * it per material costs a few ALU ops in shaders that already compute fog.
 *
 * The parameters are shared vectors: Environment.update writes their fields every frame, and the
 * uniforms below read them by reference (render group: uploaded once per render call).
 */
export const ATMOSPHERE = {
  /** x: σ₀ ground extinction (1/m); y: scale height H (m); z: ground height (m); w: 1 = on. */
  fogAtmo: new Vector4(3.912 / 25000, 1200, 0, 1),
  /** xyz: direction to the sun (or moon); w: strength of the glow around it. */
  fogSun: new Vector4(0, 1, 0, 0),
  /** Colour of the light scattered towards the viewer around the sun. */
  fogSunColor: new Vector3(1, 0.85, 0.6),
};

/** The fog's shared parameters as TSL uniforms (the sky's horizon haze reads them too). */
export const FOG_UNIFORMS = {
  atmo: uniform(ATMOSPHERE.fogAtmo).setGroup(renderGroup),
  sun: uniform(ATMOSPHERE.fogSun).setGroup(renderGroup),
  sunColor: uniform(ATMOSPHERE.fogSunColor).setGroup(renderGroup),
};

/**
 * Share of a light's own radiance that shows through any depth of haze, and the brightness (relative
 * to the haze's) from which a light starts to keep it and keeps it fully. Why: Koschmieder's
 * visibility is the distance at which a black object's contrast falls to 2 %; lights are seen much
 * farther (Allard's law: at night a lamp is seen many times the visibility away), because their
 * luminance is thousands of times the airlight's. The frame's lights are only some ten times the
 * night haze (a floodlit tower ~1.3, the rainy night's haze ~0.11), so Beer–Lambert alone put out
 * the lit Tokyo Tower 8 km off in the rain (transmission 6·10⁻⁴); the floor keeps it a faint
 * lit outline there, while dark walls at the same distance go into the haze.
 */
export const LIGHT_FLOOR = 0.04;
export const PIERCE_FROM = 2;
export const PIERCE_FULL = 8;

const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How much of the haze's colour covers a surface (the fog factor, 0–1), for an optical depth τ, the
 * linear floor's factor and the surface's brightness relative to the haze's (the shader's curve).
 */
export function hazeCover(tau: number, floorFactor: number, brightness: number): number {
  const lightsThrough = smooth(brightness, PIERCE_FROM, PIERCE_FULL);
  const veil = (1 - Math.exp(-tau)) * (1 - LIGHT_FLOOR * lightsThrough);
  return Math.max(veil, floorFactor);
}

/** Koschmieder: extinction coefficient (1/m) for a meteorological visibility (m). */
export const extinctionFor = (visibility: number) => 3.912 / Math.max(50, visibility);

/**
 * The haze's colour along a view direction (unit vector): the fog's radiance plus the sun's
 * forward-scattered glow, a tight core and a broad warm lobe around it.
 */
export function hazeTint(fogColor: Node<"vec3">, direction: Node<"vec3">): Node<"vec3"> {
  const u = FOG_UNIFORMS;
  const mu = max(dot(direction, u.sun.xyz), 0);
  const lobe = pow(mu, 24).mul(0.75).add(pow(mu, 4).mul(0.35));
  return fogColor.add(u.sunColor.mul(u.sun.w).mul(lobe));
}

/** A reference uploaded once per render call, as three's own scene fog does (ReferenceNode has
 * setGroup; its typings do not list it). */
function perRender(node: unknown): Node {
  return (node as { setGroup(group: typeof renderGroup): Node }).setGroup(renderGroup);
}

/**
 * The scene's fog node (scene.fogNode) for a three Fog whose colour (a radiance), near and far the
 * environment sets: the linear ramp is the floor, the atmosphere's optical depth the rest.
 */
export function atmosphereFog(sceneFog: Fog): Node<"vec4"> {
  const u = FOG_UNIFORMS;
  const color = perRender(reference("color", "color", sceneFog)) as Node<"vec3">;
  const near = perRender(reference("near", "float", sceneFog)) as Node<"float">;
  const far = perRender(reference("far", "float", sceneFog)) as Node<"float">;
  const floorFactor = rangeFogFactor(near, far);
  const ray = positionWorld.sub(cameraPosition);
  const dist = length(ray);
  // Optical depth of σ₀·exp(−h/H) from the eye (height h₀) along the ray rising by Δh:
  // τ = σ₀ · d · exp(−h₀/H) · (1 − exp(−Δh/H)) / (Δh/H). Near level rays take the series (the
  // quotient is 0/0 there; select keeps it out of the result).
  const k = ray.y.div(u.atmo.y);
  const rise = select(
    abs(k).greaterThan(1e-3),
    float(1).sub(exp(k.negate())).div(k),
    float(1).sub(k.mul(0.5)),
  );
  const base = exp(max(cameraPosition.y.sub(u.atmo.z), 0).negate().div(u.atmo.y));
  const tau = u.atmo.x.mul(dist).mul(base).mul(rise);
  const isOn = u.atmo.w.greaterThan(0.5);
  const direction = ray.div(max(dist, 1e-3));
  const tint = select(isOn, hazeTint(color, direction), color);
  // How: `output` is the surface's colour (NodeMaterial.setupFog assigns it before the fog node).
  const luma = vec3(0.2126, 0.7152, 0.0722);
  const brightness = dot(output.rgb, luma).div(max(dot(tint, luma), 1e-4));
  const lightsThrough = smoothstep(PIERCE_FROM, PIERCE_FULL, brightness);
  const veil = float(1).sub(exp(tau.negate())).mul(lightsThrough.mul(-LIGHT_FLOOR).add(1));
  const factor = select(isOn, max(veil, floorFactor), floorFactor);
  return fog(tint, factor);
}
