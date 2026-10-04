import { Vector3, type MeshStandardMaterial } from "three";
import { geodeticToEcef } from "../geo/ellipsoid";
import type { LocalFrame } from "../geo/frame";

/**
 * Procedural façades for untextured PLATEAU LOD1/LOD2 buildings: window grid, per-block colour
 * variation, darker roofs, and windows that light up at night.
 *
 * The pattern is computed from world position, which changes whenever the floating origin is
 * re-anchored. Adding the origin's offset modulo PERIOD keeps the pattern glued to the city;
 * PERIOD is a common multiple of every pattern scale so the wrap is invisible.
 */
const PERIOD = 288; // = 3.2 × 90 = 3.6 × 80 = 24 × 12

export const facadeUniforms = {
  uNight: { value: 0 },
  uOrigin: { value: new Vector3() },
};

export function setFacadeOrigin(frame: LocalFrame): void {
  const o = geodeticToEcef(frame.origin.lat, frame.origin.lon, frame.origin.h);
  // Project the ECEF origin onto the frame's own axes (east/up/south) in metres.
  const e = frame.ecefToLocal.elements;
  const east = e[0] * o.x + e[4] * o.y + e[8] * o.z;
  const up = e[1] * o.x + e[5] * o.y + e[9] * o.z;
  const south = e[2] * o.x + e[6] * o.y + e[10] * o.z;
  const wrap = (v: number) => ((v % PERIOD) + PERIOD) % PERIOD;
  facadeUniforms.uOrigin.value.set(wrap(east), wrap(up), wrap(south));
}

export function applyFacade(material: MeshStandardMaterial): void {
  material.customProgramCacheKey = () => "plateau-facade";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = facadeUniforms.uNight;
    shader.uniforms.uOrigin = facadeUniforms.uOrigin;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vFacadePos;\nvarying vec3 vFacadeNormal;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvFacadePos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvFacadeNormal = normalize(mat3(modelMatrix) * objectNormal);",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vFacadePos;
varying vec3 vFacadeNormal;
uniform float uNight;
uniform vec3 uOrigin;
float facadeHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float facadeWindow = 0.0;
float facadeLit = 0.0;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  vec3 fp = vFacadePos + uOrigin;
  vec3 fn = normalize(vFacadeNormal);
  float isWall = 1.0 - step(0.6, abs(fn.y));
  vec2 block = floor(fp.xz / 24.0);
  float tint = facadeHash(block);
  vec3 base = mix(vec3(0.80, 0.79, 0.76), vec3(0.60, 0.66, 0.74), tint);
  base = mix(base, vec3(0.62, 0.55, 0.48), step(0.82, facadeHash(block + 7.0)));
  float u = abs(fn.x) > abs(fn.z) ? fp.z : fp.x;
  vec2 cell = vec2(u / 3.2, fp.y / 3.6);
  vec2 w = fract(cell);
  facadeWindow = isWall * step(0.16, w.x) * step(w.x, 0.84) * step(0.28, w.y) * step(w.y, 0.82);
  facadeLit = step(0.42, facadeHash(floor(cell) + block * 13.1));
  vec3 glassCol = mix(vec3(0.14, 0.18, 0.24), vec3(0.22, 0.27, 0.33), tint);
  diffuseColor.rgb = isWall > 0.5 ? mix(base, glassCol, facadeWindow) : base * 0.72;
}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, facadeWindow);",
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * facadeWindow * facadeLit * uNight * 1.6;",
      );
  };
  material.needsUpdate = true;
}
