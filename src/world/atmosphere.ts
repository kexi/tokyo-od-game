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
  positionWorld,
  pow,
  rangeFogFactor,
  reference,
  renderGroup,
  select,
  uniform,
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
 * The old linear ramp (fogNear → fogFar) stays as a floor at the edge of the streamed world, so the
 * end of the loaded tiles never shows.
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
  const factor = select(isOn, max(float(1).sub(exp(tau.negate())), floorFactor), floorFactor);
  const direction = ray.div(max(dist, 1e-3));
  const tint = select(isOn, hazeTint(color, direction), color);
  return fog(tint, factor);
}
