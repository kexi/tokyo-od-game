import { ShaderChunk, ShaderLib, UniformsLib } from "three";

/**
 * Depth fog as the air does it, replacing three's linear fog in every built-in material:
 * - Extinction follows Beer–Lambert, 1 − exp(−τ), with τ the optical depth along the view ray, so
 *   near things keep their contrast and the haze builds up with distance instead of a wall.
 * - The air thins with height (density σ₀·exp(−h/H)): τ is integrated along the ray, so the tops of
 *   towers stand out of the haze that swallows the streets at the same distance.
 * - σ₀ comes from the meteorological visibility V (Koschmieder: V = 3.912 / σ₀, the distance at which
 *   a black object's contrast falls to 2%).
 * - Looking towards the sun the haze glows (forward Mie scattering): a warm lobe around the sun.
 * The old linear ramp (fogNear → fogFar) stays as a floor at the edge of the streamed world, so the
 * end of the loaded tiles never shows.
 *
 * Why not three's FogExp2: exp(−(ρd)²) is not how light is attenuated (it keeps the near field too
 * clean and then closes abruptly) and it has no height or sun. Why not a post-process depth pass:
 * it would need a depth texture of the whole frame and could not tell sky from far geometry; doing
 * it per material costs a few ALU ops in shaders that already compute fog.
 *
 * The parameters are shared plain objects: three clones uniform values that are vectors or colours
 * for every material, but assigns plain objects by reference, so one update reaches every material.
 * A material that lacks the uniforms (a custom ShaderMaterial) gets zeros and falls back to the
 * linear ramp.
 */
export const ATMOSPHERE = {
  /** x: σ₀ ground extinction (1/m); y: scale height H (m); z: ground height (m); w: 1 = on. */
  fogAtmo: { x: 3.912 / 25000, y: 1200, z: 0, w: 1 },
  /** xyz: direction to the sun (or moon); w: strength of the glow around it. */
  fogSun: { x: 0, y: 1, z: 0, w: 0 },
  /** Colour of the light scattered towards the viewer around the sun. */
  fogSunColor: { x: 1, y: 0.85, z: 0.6 },
};

/** Koschmieder: extinction coefficient (1/m) for a meteorological visibility (m). */
export const extinctionFor = (visibility: number) => 3.912 / Math.max(50, visibility);

const PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif
`;

// After project_vertex: `transformed` already has skinning and morphs applied.
const VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec4 fogWorld = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    fogWorld = batchingMatrix * fogWorld;
  #endif
  #ifdef USE_INSTANCING
    fogWorld = instanceMatrix * fogWorld;
  #endif
  vFogWorld = ( modelMatrix * fogWorld ).xyz;
#endif
`;

const PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  uniform vec4 fogAtmo;
  uniform vec4 fogSun;
  uniform vec3 fogSunColor;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;

const FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFloor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFloor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float fogFactor = fogFloor;
  vec3 fogTint = fogColor;
  if ( fogAtmo.w > 0.5 ) {
    vec3 fogRay = vFogWorld - cameraPosition;
    float fogDist = length( fogRay );
    // Optical depth of σ₀·exp(−h/H) from the eye (height h₀) along the ray rising by Δh:
    // τ = σ₀ · d · exp(−h₀/H) · (1 − exp(−Δh/H)) / (Δh/H).
    float fogK = fogRay.y / fogAtmo.y;
    float fogRise = abs( fogK ) > 1e-3 ? ( 1.0 - exp( - fogK ) ) / fogK : 1.0 - 0.5 * fogK;
    float fogBase = exp( - max( cameraPosition.y - fogAtmo.z, 0.0 ) / fogAtmo.y );
    float fogTau = fogAtmo.x * fogDist * fogBase * fogRise;
    fogFactor = max( 1.0 - exp( - fogTau ), fogFloor );
    // Forward scattering: a tight bright core and a broad warm lobe around the sun.
    float fogMu = max( dot( fogRay / max( fogDist, 1e-3 ), fogSun.xyz ), 0.0 );
    fogTint += fogSunColor * fogSun.w * ( 0.75 * pow( fogMu, 24.0 ) + 0.35 * pow( fogMu, 4.0 ) );
  }
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );
#endif
`;

let isInstalled = false;

/** Swap in the atmospheric fog. Call once before the first render (programs compile then). */
export function installAtmosphere(): void {
  if (isInstalled) return;
  isInstalled = true;
  ShaderChunk.fog_pars_vertex = PARS_VERTEX;
  ShaderChunk.fog_vertex = VERTEX;
  ShaderChunk.fog_pars_fragment = PARS_FRAGMENT;
  ShaderChunk.fog_fragment = FRAGMENT;
  const shared = {
    fogAtmo: { value: ATMOSPHERE.fogAtmo },
    fogSun: { value: ATMOSPHERE.fogSun },
    fogSunColor: { value: ATMOSPHERE.fogSunColor },
  };
  // ShaderLib merged UniformsLib.fog when three loaded, so each shader gets the uniforms itself;
  // UniformsLib.fog too, for ShaderMaterials built from it later.
  Object.assign(UniformsLib.fog, shared);
  for (const shader of Object.values(ShaderLib)) {
    const hasFog = "fogColor" in shader.uniforms;
    if (hasFog) Object.assign(shader.uniforms, shared);
  }
}
