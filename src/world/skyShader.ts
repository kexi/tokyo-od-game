import { BackSide, BoxGeometry, Color, Mesh, Vector3, Vector4 } from "three";
import { NodeMaterial, type Node, type UniformNode } from "three/webgpu";
import {
  acos,
  add,
  atan,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  If,
  Fn,
  length,
  max,
  min,
  mix,
  modelViewProjection,
  normalize,
  positionWorld,
  pow,
  select,
  smoothstep,
  step,
  time,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { FOG_UNIFORMS, hazeTint } from "./atmosphere";

/**
 * Tokyo's sky: three's Preetham sky with clouds (SkyMesh, its TSL port of Sky.js, followed term for
 * term) and these additions:
 * - Night: the city's light scattered back by the air (light pollution), brightest at the horizon;
 *   under a cloud deck the whole sky glows and the cloud base is lit from below.
 * - A few stars, on clear nights only and well above the horizon's glow (above ~15°).
 * - Blue hour: once the sun is below the horizon Preetham's sky goes black; a blue dome brightest on
 *   the sun's side with the afterglow low under it.
 * - Rain: an overcast deck (brighter overhead than at the horizon, as the CIE overcast sky, though
 *   only 2.2× where the CIE sky has 3×: the rain's haze fills the low sky) mottled by the sky's own
 *   cloud noise, instead of Preetham's flat white.
 * - The haze in front of the sky: the same air the depth fog integrates (atmosphere.ts), mixed in
 *   linear light like the fog, so the horizon fades into the colour of the far city.
 * - For the environment map only: the ground and a ragged skyline (lit windows at night) below
 *   and just above the horizon, so car paint and glass reflect a city, not a sky all round.
 *
 * Why a sky of our own rather than SkyMesh plus a dome over it: the stars and the glow belong
 * behind the clouds and the deck in front of them, which only the sky's own compositing knows, and
 * SkyMesh keeps its noise and its varyings inside its constructor. (The WebGL version patched these
 * into Sky.js's GLSL at five anchors; the TSL here is that patch in place.) Every addition is gated
 * by its uniform (a uniform branch), so the day sky pays only for the ozone and the gain.
 */
export type SkyLook = {
  /** Gain on Preetham's radiance. */
  uSkyGain: UniformNode<"float", number>;
  /** Ozone's blue on the sky of a low sun, 0–1. */
  uOzone: UniformNode<"float", number>;
  /** City glow at the horizon (linear radiance; 0 by day). */
  uGlow: UniformNode<"color", Color>;
  uStars: UniformNode<"float", number>;
  uTwilight: UniformNode<"float", number>;
  /** rgb: the rain deck's zenith radiance; w: how overcast, 0–1. */
  uDeck: UniformNode<"vec4", Vector4>;
  /**
   * rgb: the ground's and the blocks' albedo-like tint (times the horizon's brightness); w: 1 draws
   * them (the environment map's sky only).
   */
  uGround: UniformNode<"vec4", Vector4>;
  /** rgb: the haze (the fog's radiance); w: its strength, 0 in the environment map. */
  uHaze: UniformNode<"vec4", Vector4>;
};

type F = Node<"float">;
type V2 = Node<"vec2">;
type V3 = Node<"vec3">;
type V4 = Node<"vec4">;

/** The brightest a sky pixel may be: the sun's disc (~6·10⁴) stays inside half float (65504). */
const SKY_MAX = 60000;

export function createSkyLook(): SkyLook {
  return {
    uSkyGain: uniform(1),
    uOzone: uniform(0),
    uGlow: uniform(new Color(0, 0, 0)),
    uStars: uniform(0),
    uTwilight: uniform(0),
    uDeck: uniform(new Vector4(0, 0, 0, 0)),
    uGround: uniform(new Vector4(0, 0, 0, 0)),
    uHaze: uniform(new Vector4(0, 0, 0, 0)),
  };
}

// Sinless 3D hash (as the clouds' gradient()), for the stars and the skyline.
function skyHash3(q: V3): V3 {
  const p = fract(q.mul(vec3(0.1031, 0.103, 0.0973))).toVar();
  p.addAssign(dot(p, p.yxz.add(33.33)));
  return fract(p.xxy.add(p.yxx).mul(p.zyx));
}

// Gradient at a lattice corner; sinless hash so every GPU produces the same clouds (SkyMesh).
function gradient(i: V2): V2 {
  const p = fract(vec3(i.x, i.y, i.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
  p.addAssign(dot(p, p.yzx.add(33.33)));
  return fract(p.xx.add(p.yz).mul(p.zy)).mul(2).sub(1);
}

// 2D gradient noise: isotropic lobes like Perlin at value-noise cost (SkyMesh), ~[−1, 1].
function noise(p: V2): F {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f
    .mul(f)
    .mul(f)
    .mul(f.mul(f.mul(6).sub(15)).add(10));
  const a = dot(gradient(i), f);
  const b = dot(gradient(i.add(vec2(1, 0))), f.sub(vec2(1, 0)));
  const c = dot(gradient(i.add(vec2(0, 1))), f.sub(vec2(0, 1)));
  const d = dot(gradient(i.add(vec2(1, 1))), f.sub(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y).mul(1.6);
}

// fbm; per-octave drift makes clouds billow instead of scrolling as a rigid stamp (SkyMesh). How:
// the four octaves unrolled at build time.
function fbm(position: V2, drift: F): F {
  let p: V2 = position;
  let result: F = float(0);
  let amplitude = 1;
  for (let o = 0; o < 4; o++) {
    result = result.add(noise(p).mul(amplitude));
    amplitude *= 0.5;
    p = p.mul(2).add(drift);
  }
  return result;
}

/**
 * The sky dome (a box around the camera; Environment moves it with the camera). The uniforms have
 * SkyMesh's names and types, so code written for SkyMesh drives it unchanged; `look` holds the
 * additions' values (Environment.update sets them from skyLight.ts every frame).
 */
export class TokyoSky extends Mesh<BoxGeometry, NodeMaterial> {
  readonly turbidity = uniform(2);
  readonly rayleigh = uniform(1);
  readonly mieCoefficient = uniform(0.005);
  readonly mieDirectionalG = uniform(0.8);
  readonly sunPosition = uniform(new Vector3());
  readonly cloudScale = uniform(0.0002);
  readonly cloudSpeed = uniform(0.00002);
  readonly cloudCoverage = uniform(0.4);
  readonly cloudDensity = uniform(0.4);
  readonly cloudElevation = uniform(0.5);
  readonly showSunDisc = uniform(1);
  readonly look = createSkyLook();

  constructor() {
    super(new BoxGeometry(1, 1, 1), new NodeMaterial());
    const material = this.material;
    material.name = "tokyo-sky";
    material.side = BackSide;
    material.depthWrite = false;
    // The sky's haze is its own (it has no depth for the fog to integrate).
    material.fog = false;
    // At the far plane (z = w), as SkyMesh.
    const clip = modelViewProjection as unknown as V4;
    material.vertexNode = vec4(clip.x, clip.y, clip.w, clip.w);
    material.colorNode = this.buildColour();
  }

  private buildColour(): V4 {
    const look = this.look;
    // Per vertex, as SkyMesh's varyings (they depend on the uniforms only).
    const sunDirection = normalize(this.sunPosition);
    const zenithAngleCos = clamp(sunDirection.y, -1, 1);
    const sunE = float(1000).mul(
      max(0, float(1).sub(exp(float(1.6110731556870734).sub(acos(zenithAngleCos)).div(1.5).negate()))),
    );
    const sunfade = float(1).sub(clamp(float(1).sub(exp(this.sunPosition.y.div(450000))), 0, 1));
    const rayleighCoefficient = this.rayleigh.sub(sunfade.oneMinus());
    const totalRayleigh = vec3(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5);
    const mieConst = vec3(1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14);
    // Preetham's Mie coefficient: 0.434 · c · MieConst, with c = 0.2 · T · 10⁻¹⁷ (0.434 is his,
    // written as 0.217 · 2 so it is not read as log₁₀e).
    const totalMie = float(0.217 * 2)
      .mul(float(0.2).mul(this.turbidity).mul(10e-18))
      .mul(mieConst);
    const vSunDirection = varying(sunDirection) as V3;
    const vSunE = varying(sunE) as F;
    const vBetaR = varying(totalRayleigh.mul(rayleighCoefficient)) as V3;
    const vBetaM = varying(totalMie.mul(this.mieCoefficient)) as V3;

    return Fn(() => {
      const pi = Math.PI;
      const direction = normalize(positionWorld.sub(cameraPosition)).toVar();
      // Optical length; the zenith angle is cut off at 90° to avoid the formula's singularity.
      const zenithAngle = acos(max(0, direction.y));
      const inverse = float(1).div(
        cos(zenithAngle).add(float(0.15).mul(pow(float(93.885).sub(zenithAngle.mul(180 / pi)), -1.253))),
      );
      const sR = inverse.mul(8.4e3);
      const sM = inverse.mul(1.25e3);
      // Combined extinction factor.
      const Fex = exp(vBetaR.mul(sR).add(vBetaM.mul(sM)).negate()).toVar();
      // In-scattering.
      const cosTheta = dot(direction, vSunDirection).toVar();
      const c = cosTheta.mul(0.5).add(0.5);
      const rPhase = float(3 / (16 * pi)).mul(c.mul(c).add(1));
      const betaRTheta = vBetaR.mul(rPhase);
      const g = this.mieDirectionalG;
      const g2 = g.mul(g);
      const hg = float(1).div(pow(float(1).sub(g.mul(2).mul(cosTheta)).add(g2), 1.5));
      const mPhase = float(1 / (4 * pi))
        .mul(g2.oneMinus())
        .mul(hg);
      const betaMTheta = vBetaM.mul(mPhase);
      const ratio = add(betaRTheta, betaMTheta).div(add(vBetaR, vBetaM)).toVar();
      const Lin = pow(vSunE.mul(ratio).mul(Fex.oneMinus()), vec3(1.5)).toVar();
      Lin.mulAssign(
        mix(
          vec3(1),
          pow(vSunE.mul(ratio).mul(Fex), vec3(0.5)),
          clamp(pow(vSunDirection.y.oneMinus(), 5), 0, 1),
        ),
      );
      // Night sky.
      const L0 = Fex.mul(0.1);
      // Composition and the solar disc.
      const sundisc = clamp(cosTheta.sub(0.9999566769464484).mul(50000), 0, 1).mul(this.showSunDisc);
      const sundiscColor = min(vSunE.mul(Fex), 80).mul(760).mul(sundisc).toVar();
      const texColor = Lin.add(L0)
        .mul(0.04)
        .add(sundiscColor)
        .add(vec3(0, 0.0003, 0.00075))
        .toVar();

      // Behind the clouds (they composite over what is added here).
      // Ozone (the Chappuis band) takes orange and green out of a low sun's long light path: the
      // dusk sky turns blue instead of Preetham's teal (not the sun's own glow).
      const skyOzone = look.uOzone.mul(pow(max(cosTheta, 0), 3).oneMinus());
      const gain = look.uSkyGain.mul(mix(vec3(1), vec3(0.66, 0.8, 1.2), skyOzone)).toVar();
      texColor.mulAssign(gain);
      // The disc as it now shows, for the clouds to hide (the night term is too faint to matter).
      sundiscColor.mulAssign(gain);
      const skyUp = max(direction.y, 0).toVar();
      // Guarded and clamped: a zero-length normalize or the pow() of a negative rounding error is
      // NaN, and one NaN in the environment map spreads through every filtered mip.
      const sunAz = normalize(vSunDirection.xz.add(vec2(1e-5)));
      const azDir = direction.xz.div(max(length(direction.xz), 1e-4));
      const sunSide = clamp(dot(azDir, sunAz).mul(0.5).add(0.5), 0, 1);
      If(look.uTwilight.greaterThan(0), () => {
        const dome = vec3(0.005, 0.0095, 0.026).mul(sunSide.mul(0.55).add(0.45)).mul(skyUp.mul(-0.4).add(1));
        const afterglow = vec3(0.045, 0.02, 0.006)
          .mul(pow(sunSide, 4))
          .mul(exp(skyUp.mul(-9)));
        texColor.addAssign(dome.add(afterglow).mul(look.uTwilight));
      });
      texColor.addAssign(look.uGlow.mul(exp(skyUp.mul(-6)).mul(0.78).add(0.22)));
      If(look.uStars.greaterThan(0), () => {
        // A hash on a 240-cell grid over the sphere: about one cell in 3,300 holds a star.
        const starCell = floor(direction.mul(240));
        const starRnd = skyHash3(starCell);
        const starAt = normalize(starCell.add(0.25).add(starRnd.yzx.mul(0.5)).div(240));
        const starD = length(direction.sub(starAt)).mul(240);
        const star = smoothstep(0, 0.55, starD).oneMinus().mul(starRnd.y.mul(starRnd.y).mul(0.75).add(0.25));
        const isStar = step(0.9997, starRnd.x).mul(step(0.25, direction.y));
        const high = smoothstep(0.25, 0.5, direction.y);
        texColor.addAssign(vec3(0.95, 0.97, 1).mul(star.mul(isStar).mul(look.uStars).mul(0.14).mul(high)));
      });

      // Clouds (SkyMesh), the cloud base lit by the city.
      If(direction.y.greaterThan(0).and(this.cloudCoverage.greaterThan(0)), () => {
        // Project to the cloud plane (higher elevation = clouds appear lower/closer).
        const elevation = mix(1, 0.1, this.cloudElevation);
        const cloudUV = direction.xz
          .div(direction.y.mul(elevation))
          .mul(this.cloudScale)
          .add(time.mul(this.cloudSpeed))
          .toVar();
        const evolve = time.mul(this.cloudSpeed).mul(300);
        const cloudNoise = clamp(fbm(cloudUV.mul(1000), evolve).mul(0.7).add(0.5), 0, 1).toVar();
        // Large-scale coverage variation: clear gaps next to dense banks.
        const region = noise(cloudUV.mul(300)).mul(0.37).add(0.5);
        const cov = clamp(this.cloudCoverage.add(region.sub(0.5).mul(0.6)), 0, 1);
        const threshold = cov.oneMinus().toVar();
        const cloudMask = smoothstep(threshold, threshold.add(0.3), cloudNoise).toVar();
        const horizonFade = smoothstep(0, this.cloudElevation.mul(0.06).add(0.03), direction.y);
        cloudMask.mulAssign(horizonFade);
        // Cloud lighting from the sky's own radiance.
        const dayFactor = smoothstep(-0.08, 0.3, vSunDirection.y);
        const sunColor = vSunE
          .mul(Fex)
          .mul(0.22 * 0.04)
          .toVar();
        const skyAmbient = Lin.mul(0.04).add(vec3(0, 0.0003, 0.00075));
        // Beer-powder self-shadow from the sampled density.
        const depth = max(0, cloudNoise.sub(threshold)).toVar();
        const beer = exp(depth.mul(-4)).toVar();
        const powder = beer.mul(beer).oneMinus();
        const shade = mix(0.45, 1, clamp(beer.mul(powder).mul(2.6), 0, 1)).toVar();
        // Henyey-Greenstein forward lobe (g = 0.7): silver lining on rims toward the sun.
        const silver = clamp(float(0.51).div(pow(float(1.49).sub(cosTheta.mul(1.4)), 1.5)), 0, 3);
        const edge = cloudMask.mul(cloudMask.oneMinus()).mul(4);
        const cloudColor = skyAmbient.add(sunColor.mul(shade)).toVar();
        cloudColor.addAssign(sunColor.mul(silver).mul(edge).mul(0.6));
        cloudColor.mulAssign(max(dayFactor, 0.03));
        // The cloud base reflects the city's light down.
        cloudColor.addAssign(look.uGlow.mul(shade).mul(0.9));
        // Opacity by Beer's law; the sun's disc and glow hide behind opaque cloud.
        const alpha = exp(depth.mul(this.cloudDensity).mul(-12)).oneMinus().mul(horizonFade).toVar();
        texColor.subAssign(L0.mul(0.04).add(sundiscColor).mul(alpha));
        // Composite through the atmosphere so distant clouds dissolve into haze.
        const cloudAerial = mix(texColor, cloudColor, Fex);
        texColor.assign(mix(texColor, cloudAerial, alpha));
      });

      // In front of the clouds: the rain deck.
      If(look.uDeck.w.greaterThan(0), () => {
        const deckUV = direction.xz
          .div(skyUp.add(0.12))
          .mul(this.cloudScale.mul(500))
          .add(time.mul(this.cloudSpeed).mul(30));
        const deckNoise = clamp(fbm(deckUV, time.mul(this.cloudSpeed).mul(60)).mul(0.5).add(0.5), 0, 1);
        const deck = look.uDeck.xyz
          .mul(skyUp.mul(1.2).add(1))
          .div(2.2)
          .mul(mix(0.78, 1.12, deckNoise))
          .add(look.uGlow.mul(0.75).mul(mix(0.85, 1.15, deckNoise)));
        texColor.assign(mix(texColor, deck, look.uDeck.w));
      });

      // The environment map's ground and skyline.
      If(look.uGround.w.greaterThan(0.5), () => {
        // As light, Preetham's radiance is far bluer than the sky looks: half of it is kept. Held
        // below 16 too: Preetham's glow around the (hidden) sun reaches hundreds, which the rough
        // mips would smear into fireflies; the sun's highlight is the DirectionalLight's.
        texColor.assign(min(texColor, vec3(16)));
        const skyLuma = dot(texColor, vec3(0.2126, 0.7152, 0.0722)).toVar();
        texColor.assign(mix(vec3(skyLuma), texColor, 0.5));
        // The city under and just above the horizon, lit as the horizon is (texColor below it is
        // the horizon's): the ground, and blocks of 3–8° all round (sin of elevation), windows lit
        // at night.
        const skyAz = atan(direction.z, direction.x);
        const blockRnd = skyHash3(vec3(floor(skyAz.mul(18)), 7, 3));
        const skyline = blockRnd.x.mul(0.09).add(0.05);
        const windowRnd = skyHash3(vec3(floor(skyAz.mul(260)), floor(direction.y.mul(260)), 11));
        const ground = look.uGround.xyz.mul(skyLuma);
        const facade = ground
          .mul(mix(1.3, 2, blockRnd.y))
          .add(look.uGlow.mul(6).mul(step(0.82, windowRnd.x)));
        const city = mix(facade, texColor, skyUp.mul(0.35).div(skyline).add(0.25));
        const below = mix(ground, texColor, exp(direction.y.mul(30)).mul(0.4));
        const above = mix(texColor, city, step(direction.y, skyline));
        texColor.assign(select(direction.y.lessThan(0), below, above));
      });

      // The haze in front of everything: the optical depth of σ₀·exp(−h/H) up a ray at this
      // elevation, σ₀·H / sin(elevation), and the fog's colour and sun glow (atmosphere.ts).
      If(look.uHaze.w.greaterThan(0), () => {
        const atmo = FOG_UNIFORMS.atmo;
        const tau = atmo.x.mul(atmo.y).div(max(direction.y, 0.02)).mul(look.uHaze.w);
        texColor.assign(mix(texColor, hazeTint(look.uHaze.xyz, direction), exp(tau.negate()).oneMinus()));
      });
      return vec4(clamp(texColor, 0, SKY_MAX), 1);
    })();
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
