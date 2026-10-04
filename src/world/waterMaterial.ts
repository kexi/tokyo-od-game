import { Color, ShaderMaterial, UniformsLib, UniformsUtils, Vector3, type Texture, Matrix4 } from "three";

/**
 * Water surface of the rivers, canals and the bay.
 * - Ripples are a sum of a few directional sine waves (their analytic slopes) plus two scrolling
 *   octaves of value noise, all procedural, so no normal-map texture is shipped. They fade with
 *   distance: far water reads as a calmer mirror and does not shimmer as the pixels undersample it.
 * - Reflection: the planar reflection of the scene (WaterLayer.renderReflection, one render for the
 *   nearest water level, half resolution) where this fragment lies within ~1 m of that level; the sky
 *   (horizon = fog colour, a darker zenith, the sun) elsewhere and on phones.
 * - Fresnel (Schlick, F0 = 0.02 for water): the river's own colour looking down from a bridge, the
 *   reflection at grazing angles. Tokyo's rivers are turbid, a dark green-grey body colour.
 * - Sun glint: a sharp specular lobe along the reflected ray.
 * - The atmospheric fog of atmosphere.ts via the fog chunks; tone mapping like the built-in
 *   materials. The tide raises the tidal vertices (aTidal = 1) by uTide.
 * Why not three's Water (examples/objects/Water.js): it needs a normal-map texture, renders its own
 * reflection for each water object, and has no fallback for water at other levels.
 */
export function createWaterMaterial(waves: number): ShaderMaterial {
  return new ShaderMaterial({
    name: "water",
    fog: true,
    defines: { WAVES: waves },
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uTime: { value: 0 },
        uTide: { value: 0 },
        uReflection: { value: null as Texture | null },
        uReflectionOn: { value: 0 },
        uReflectionMatrix: { value: new Matrix4() },
        uPlaneY: { value: 0 },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color(0xffffff) },
        uSunStrength: { value: 1 },
        uSkyZenith: { value: new Color(0x3d6fb0) },
        uSkyHorizon: { value: new Color(0xbfd2e4) },
        uBody: { value: new Color(0x1d2a26) },
        uAmbient: { value: 1 },
        uRough: { value: 1 },
      },
    ]),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
}

const VERTEX = /* glsl */ `
attribute float aTidal;
uniform float uTide;
uniform mat4 uReflectionMatrix;
varying vec3 vWorld;
varying vec4 vReflect;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vec3 transformed = position;
  transformed.y += aTidal * uTide;
  vec4 world = modelMatrix * vec4( transformed, 1.0 );
  vWorld = world.xyz;
  vReflect = uReflectionMatrix * world;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform sampler2D uReflection;
uniform float uReflectionOn;
uniform float uPlaneY;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunStrength;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uBody;
uniform float uAmbient;
uniform float uRough;
varying vec3 vWorld;
varying vec4 vReflect;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>

float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

// Value noise and its gradient (quintic fade).
vec3 noised( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  vec2 du = 30.0 * f * f * ( f * ( f - 2.0 ) + 1.0 );
  float a = hash12( i );
  float b = hash12( i + vec2( 1.0, 0.0 ) );
  float c = hash12( i + vec2( 0.0, 1.0 ) );
  float d = hash12( i + vec2( 1.0, 1.0 ) );
  float k = a - b - c + d;
  return vec3( a + ( b - a ) * u.x + ( c - a ) * u.y + k * u.x * u.y,
               du * ( vec2( b - a, c - a ) + k * u.yx ) );
}

// Slope (dh/dx, dh/dz) of the ripples at p (metres), t (s): octaves of value noise, each on a
// rotated, drifting grid so no lattice or crest lines line up, over a few long, low swells.
vec2 ripples( vec2 p, float t ) {
  vec2 slope = vec2( 0.0 );
  const float L[4] = float[4]( 9.1, 5.3, 3.4, 2.1 );
  const float D[4] = float[4]( 0.3, 1.9, -0.8, 2.7 );
  for ( int i = 0; i < WAVES; i++ ) {
    if ( i >= 4 ) break;
    float k = 6.2831853 / L[i];
    vec2 dir = vec2( cos( D[i] ), sin( D[i] ) );
    // Deep-water dispersion: ω = √(g k); slope amplitude ~0.6 % of the wavelength.
    slope += dir * ( 0.006 * L[i] * k * cos( dot( dir, p ) * k - sqrt( 9.81 * k ) * t ) );
  }
  // Octave o samples n(R^o · p · f_o): its slope is f_o · (R^o)ᵀ ∇n, i.e. ∇n * R^o as a row vector.
  mat2 turn = mat2( 0.8, 0.6, -0.6, 0.8 );
  mat2 rot = mat2( 1.0 );
  float freq = 0.42;
  float amp = 0.07;
  vec2 drift = vec2( 0.31, 0.17 ) * t;
  for ( int o = 0; o < 4; o++ ) {
    vec3 n = noised( rot * p * freq + drift );
    slope += amp * freq * ( n.yz * rot );
    rot = turn * rot;
    freq *= 2.17;
    drift = turn * drift * 1.35;
    amp *= 0.5;
  }
  return slope;
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 toEye = cameraPosition - vWorld;
  float dist = length( toEye );
  vec3 V = toEye / max( dist, 1e-3 );
  // Calmer with distance (and at grazing angles, where the ripples alias); rougher in rain.
  float fade = uRough / ( 1.0 + dist / 120.0 );
  vec2 slope = ripples( vWorld.xz, uTime ) * fade;
  vec3 N = normalize( vec3( -slope.x, 1.0, -slope.y ) );
  float cosV = clamp( dot( N, V ), 0.0, 1.0 );
  float fresnel = 0.02 + 0.98 * pow( 1.0 - cosV, 5.0 );
  vec3 R = reflect( -V, N );
  R.y = abs( R.y );
  vec3 sky = mix( uSkyHorizon, uSkyZenith, pow( R.y, 0.6 ) );
  vec3 reflected = sky;
  float onPlane = uReflectionOn * ( 1.0 - smoothstep( 0.5, 1.2, abs( vWorld.y - uPlaneY ) ) );
  if ( onPlane > 0.0 ) {
    vec2 uv = vReflect.xy / vReflect.w + N.xz * ( 0.12 / ( 1.0 + dist * 0.05 ) );
    vec3 planar = texture2D( uReflection, clamp( uv, vec2( 0.001 ), vec2( 0.999 ) ) ).rgb;
    reflected = mix( sky, planar, onPlane );
  }
  vec3 body = uBody * uAmbient;
  vec3 color = mix( body, reflected, fresnel );
  float glint = pow( max( dot( R, uSunDir ), 0.0 ), 600.0 ) * 60.0 + pow( max( dot( R, uSunDir ), 0.0 ), 60.0 ) * 0.6;
  color += uSunColor * glint * uSunStrength * fresnel;
  gl_FragColor = vec4( color, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
