import { Color, Vector4 } from "three";
import type { Sky } from "three/addons/objects/Sky.js";
import { ATMOSPHERE } from "./atmosphere";

/**
 * Tokyo's sky on top of three's Preetham sky (Sky.js), as additions to its fragment shader:
 * - Night: the city's light scattered back by the air (light pollution), brightest at the horizon;
 *   under a cloud deck the whole sky glows and the cloud base is lit from below.
 * - A few stars, on clear nights only and well above the horizon's glow.
 * - Blue hour: once the sun is below the horizon Preetham's sky goes black; a blue dome brightest on
 *   the sun's side with the afterglow low under it.
 * - Rain: an overcast deck (brighter overhead than at the horizon, as the CIE overcast sky, though
 *   only 2.2× where the CIE sky has 3×: the rain's haze fills the low sky) mottled by the sky's own
 *   cloud noise, instead of Preetham's flat white.
 * - The haze in front of the sky: the same air the depth fog integrates (atmosphere.ts), so the
 *   horizon fades into the colour of the far city.
 * - For the environment map only: the ground and a ragged skyline (lit windows at night) below
 *   and just above the horizon, so car paint and glass reflect a city, not a sky all round.
 *
 * Why patch the source rather than draw a second dome over the sky: the stars and the glow belong
 * behind the clouds and the deck in front of them, which only the sky's own compositing knows. The
 * anchors are checked (tests/sky.test.ts runs the patch on the installed three), and a failed patch
 * leaves the plain sky.
 */
// WEBGPU-TODO(phase B): these additions are GLSL patched into Sky.js and do not reach the SkyMesh
// (TSL) that environment.ts and skyEnvMap.ts draw on WebGPU. Port them as TSL onto SkyMesh's colour
// (or a sky of our own), keeping SkyLook: Environment.update sets these values from skyLight.ts and
// syncEnvSky copies them into the environment map's sky.
export type SkyLook = {
  /** Gain on Preetham's radiance. */
  uSkyGain: { value: number };
  /** Ozone's blue on the sky of a low sun, 0–1. */
  uOzone: { value: number };
  /** City glow at the horizon (linear radiance; 0 by day). */
  uGlow: { value: Color };
  uStars: { value: number };
  uTwilight: { value: number };
  /** rgb: the rain deck's zenith radiance; w: how overcast, 0–1. */
  uDeck: { value: Vector4 };
  /**
   * rgb: the ground's and the blocks' albedo-like tint (times the horizon's brightness); w: 1 draws
   * them (the environment map's sky only).
   */
  uGround: { value: Vector4 };
  /** rgb: the haze (the fog's radiance); w: its strength, 0 in the environment map. */
  uHaze: { value: Vector4 };
};

const PARS = /* glsl */ `
uniform float uSkyGain;
uniform float uOzone;
uniform vec3 uGlow;
uniform float uStars;
uniform float uTwilight;
uniform vec4 uDeck;
uniform vec4 uGround;
uniform vec4 uHaze;
uniform vec4 fogAtmo;
uniform vec4 fogSun;
uniform vec3 fogSunColor;

// Sinless 3D hash (as the sky's own gradient()), for the stars and the skyline.
vec3 skyHash3( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.xxy + p.yxx ) * p.zyx );
}
`;

// Behind the clouds: they composite over what is added here.
const BEHIND_CLOUDS = /* glsl */ `
  // Ozone (the Chappuis band) takes orange and green out of a low sun's long light path: the dusk
  // sky turns blue instead of Preetham's teal (not the sun's own glow).
  float skyOzone = uOzone * ( 1.0 - pow( max( cosTheta, 0.0 ), 3.0 ) );
  texColor *= uSkyGain * mix( vec3( 1.0 ), vec3( 0.66, 0.8, 1.2 ), skyOzone );
  float skyUp = max( direction.y, 0.0 );
  vec2 skySunAz = normalize( vSunDirection.xz + vec2( 1e-5 ) );
  // Guarded and clamped: a zero-length normalize or the pow() of a negative rounding error is NaN,
  // and one NaN in the environment map spreads through every filtered mip.
  vec2 skyAzDir = direction.xz / max( length( direction.xz ), 1e-4 );
  float skySunSide = clamp( dot( skyAzDir, skySunAz ) * 0.5 + 0.5, 0.0, 1.0 );
  texColor += uTwilight * (
    vec3( 0.005, 0.0095, 0.026 ) * ( 0.45 + 0.55 * skySunSide ) * ( 1.0 - 0.4 * skyUp ) +
    vec3( 0.045, 0.02, 0.006 ) * pow( skySunSide, 4.0 ) * exp( - skyUp * 9.0 ) );
  texColor += uGlow * ( 0.22 + 0.78 * exp( - skyUp * 6.0 ) );
  if ( uStars > 0.0 && direction.y > 0.25 ) {
    vec3 starCell = floor( direction * 240.0 );
    vec3 starRnd = skyHash3( starCell );
    if ( starRnd.x > 0.9997 ) {
      vec3 starAt = normalize( ( starCell + 0.25 + 0.5 * starRnd.yzx ) / 240.0 );
      float starD = length( direction - starAt ) * 240.0;
      float star = ( 1.0 - smoothstep( 0.0, 0.55, starD ) ) * ( 0.25 + 0.75 * starRnd.y * starRnd.y );
      texColor += vec3( 0.95, 0.97, 1.0 ) * star * uStars * 0.14 * smoothstep( 0.25, 0.5, direction.y );
    }
  }
`;

// The cloud base reflects the city's light down.
const CLOUD_LIT = /* glsl */ `
        cloudColor += uGlow * 0.9 * shade;
`;

const OVER_ALL = /* glsl */ `
  if ( uDeck.w > 0.0 ) {
    vec2 deckUV = direction.xz / ( skyUp + 0.12 ) * cloudScale * 500.0 + time * cloudSpeed * 30.0;
    float deckNoise = clamp( fbm( deckUV, time * cloudSpeed * 60.0 ) * 0.5 + 0.5, 0.0, 1.0 );
    vec3 deck = uDeck.rgb * ( 1.0 + 1.2 * skyUp ) / 2.2 * mix( 0.78, 1.12, deckNoise ) +
      uGlow * 0.75 * mix( 0.85, 1.15, deckNoise );
    texColor = mix( texColor, deck, uDeck.w );
  }
  if ( uGround.w > 0.5 ) {
    // As light, Preetham's radiance is far bluer than the sky looks: half of it is kept.
    // Held below 16 too: Preetham's glow around the (hidden) sun reaches hundreds, which the rough
    // mips would smear into fireflies; the sun's highlight is the DirectionalLight's.
    texColor = min( texColor, vec3( 16.0 ) );
    float skyLuma = dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) );
    texColor = mix( vec3( skyLuma ), texColor, 0.5 );
    // The city under and just above the horizon, lit as the horizon is (texColor below it is the
    // horizon's): the ground, and blocks of 3–8° all round (sin of elevation), windows lit at night.
    float skyAz = atan( direction.z, direction.x );
    vec3 blockRnd = skyHash3( vec3( floor( skyAz * 18.0 ), 7.0, 3.0 ) );
    float skyline = 0.05 + 0.09 * blockRnd.x;
    vec3 windowRnd = skyHash3( vec3( floor( skyAz * 260.0 ), floor( direction.y * 260.0 ), 11.0 ) );
    vec3 facade = uGround.rgb * skyLuma * mix( 1.3, 2.0, blockRnd.y ) + uGlow * 6.0 * step( 0.82, windowRnd.x );
    vec3 city = mix( facade, texColor, 0.25 + 0.35 * skyUp / skyline );
    vec3 ground = mix( uGround.rgb * skyLuma, texColor, exp( direction.y * 30.0 ) * 0.4 );
    texColor = direction.y < 0.0 ? ground : mix( texColor, city, step( direction.y, skyline ) );
  }
`;

const HAZE = /* glsl */ `
  if ( uHaze.w > 0.0 ) {
    // Optical depth of σ₀·exp(−h/H) up a ray at this elevation: σ₀·H / sin(elevation).
    float hazeTau = fogAtmo.x * fogAtmo.y / max( direction.y, 0.02 ) * uHaze.w;
    float hazeMu = max( dot( direction, fogSun.xyz ), 0.0 );
    vec3 hazeTint = uHaze.rgb + fogSunColor * fogSun.w * ( 0.75 * pow( hazeMu, 24.0 ) + 0.35 * pow( hazeMu, 4.0 ) );
    // Shown as atmosphere.ts shows the fog on the city: tone-mapped and encoded.
    #ifdef TONE_MAPPING
      hazeTint = toneMapping( hazeTint );
    #endif
    hazeTint = linearToOutputTexel( vec4( hazeTint, 1.0 ) ).rgb;
    gl_FragColor.rgb = mix( gl_FragColor.rgb, hazeTint, 1.0 - exp( - hazeTau ) );
  }
`;

const ANCHORS = {
  pars: "uniform float time;",
  texColor: "vec3 texColor = ( Lin + L0 ) * 0.04 + sundiscColor + vec3( 0.0, 0.0003, 0.00075 );",
  cloudDim: "cloudColor *= max( dayFactor, 0.03 );",
  output: "gl_FragColor = vec4( texColor, 1.0 );",
  encoded: "#include <colorspace_fragment>",
} as const;

/** Sky.js's fragment shader with the additions; throws when an anchor is missing (a three update). */
export function patchSkyFragment(source: string): string {
  for (const [name, anchor] of Object.entries(ANCHORS)) {
    const count = source.split(anchor).length - 1;
    if (count !== 1) throw new Error(`sky shader: anchor "${name}" found ${count} times`);
  }
  return source
    .replace(ANCHORS.pars, `${ANCHORS.pars}\n${PARS}`)
    .replace(ANCHORS.texColor, `${ANCHORS.texColor}\n${BEHIND_CLOUDS}`)
    .replace(ANCHORS.cloudDim, `${ANCHORS.cloudDim}\n${CLOUD_LIT}`)
    .replace(ANCHORS.output, `${OVER_ALL}\n${ANCHORS.output}`)
    .replace(ANCHORS.encoded, `${ANCHORS.encoded}\n${HAZE}`);
}

/**
 * Give a Sky the additions and their uniforms (null when the patch does not apply: the sky stays
 * Preetham's). The haze reads the depth fog's shared parameters by reference.
 */
export function upgradeSky(sky: Sky): SkyLook | null {
  const material = sky.material;
  try {
    material.fragmentShader = patchSkyFragment(material.fragmentShader);
  } catch {
    return null;
  }
  const look: SkyLook = {
    uSkyGain: { value: 1 },
    uOzone: { value: 0 },
    uGlow: { value: new Color(0, 0, 0) },
    uStars: { value: 0 },
    uTwilight: { value: 0 },
    uDeck: { value: new Vector4(0, 0, 0, 0) },
    uGround: { value: new Vector4(0, 0, 0, 0) },
    uHaze: { value: new Vector4(0, 0, 0, 0) },
  };
  Object.assign(material.uniforms, look, {
    fogAtmo: { value: ATMOSPHERE.fogAtmo },
    fogSun: { value: ATMOSPHERE.fogSun },
    fogSunColor: { value: ATMOSPHERE.fogSunColor },
  });
  material.needsUpdate = true;
  return look;
}
