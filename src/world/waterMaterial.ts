import { Color, Matrix4, Texture, Vector3 } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  cameraPosition,
  dot,
  float,
  max,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  uniform,
  vec3,
} from "three/tsl";

/**
 * Water surface of the rivers, canals and the bay.
 *
 * WEBGPU-TODO(phase B): the full water shader of the WebGL version (git show e9969cf:src/world/
 * waterMaterial.ts) in TSL — ripples (a few directional sine swells plus drifting value noise,
 * calmer with distance, rougher in rain), the planar reflection where the fragment is within ~1 m
 * of the reflected level (WaterLayer.renderReflection), the river's turbid body colour by Fresnel
 * (Schlick, F0 = 0.02) and the sun glint, under the atmospheric fog. Standing in until then: a flat
 * mirror of the sky's two colours by Fresnel over the body colour, with the glint, and the tide
 * raising the tidal vertices — enough for the water to be where it is, at the right height.
 *
 * The uniforms keep the WebGL material's names and value types (WaterLayer sets them every frame:
 * uTime, uTide, uSunDir, uSunColor, uSunStrength, uSkyZenith, uSkyHorizon, uAmbient, uRough;
 * uReflection, uReflectionOn, uReflectionMatrix, uPlaneY for the reflection), so the port can drop
 * in behind the same interface. Each is a TSL uniform node, whose `.value` works as before.
 */
export type WaterMaterial = MeshBasicNodeMaterial & {
  uniforms: ReturnType<typeof waterUniforms>;
  /** Kept for WaterLayer, which flags a per-mesh uniform change (node uniforms need no flag). */
  uniformsNeedUpdate: boolean;
};

function waterUniforms() {
  return {
    uTime: uniform(0),
    uTide: uniform(0),
    uReflection: { value: null as Texture | null },
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

export function createWaterMaterial(waves: number): WaterMaterial {
  void waves; // the ripples' octave count, for the port
  const u = waterUniforms();
  const material = new MeshBasicNodeMaterial() as WaterMaterial;
  material.name = "water";
  material.uniforms = u;
  material.uniformsNeedUpdate = false;
  // The tide raises the tidal vertices (aTidal = 1).
  material.positionNode = positionLocal.add(vec3(0, attribute<"float">("aTidal", "float").mul(u.uTide), 0));
  const toEye = cameraPosition.sub(positionWorld);
  const v = normalize(toEye);
  const n = vec3(0, 1, 0);
  const cosV = max(dot(n, v), 0);
  const fresnel = float(0.98).mul(pow(cosV.oneMinus(), 5)).add(0.02);
  const r = reflect(v.negate(), n);
  const sky = mix(u.uSkyHorizon, u.uSkyZenith, pow(max(r.y, 0), 0.6));
  const body = u.uBody.mul(u.uAmbient);
  const sun = max(dot(r, u.uSunDir), 0);
  const glint = pow(sun, 600).mul(60).add(pow(sun, 60).mul(0.6));
  material.colorNode = mix(body, sky, fresnel).add(u.uSunColor.mul(glint).mul(u.uSunStrength).mul(fresnel));
  return material;
}
