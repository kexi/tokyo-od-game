import { Matrix3 } from "three";
import { MeshBasicNodeMaterial, type Node, type NodeBuilder } from "three/webgpu";
import { mat3, max, min, saturate, sqrt, toneMappingExposure, vec3 } from "three/tsl";

/**
 * Colours that must show on screen as they are, not tone-mapped: the lit lamps of the signals and
 * the オービス strobe, which the WebGL version drew with `toneMapped: false` (the display showed the
 * material's colour, sRGB-encoded, and nothing else).
 *
 * Here every material is drawn into one linear HDR frame and ACES + sRGB is applied once at the end
 * (render/frame.ts), so a material cannot opt out of the tone mapping: WebGPURenderer ignores
 * `toneMapped` altogether. Instead such a material outputs the radiance that the frame's ACES maps
 * back to the colour it wants shown. How, for a wanted display colour d (linear sRGB, 0…1), undoing
 * three r186's ACESFilmicToneMapping (nodes/display/ToneMappingFunctions.js) step by step:
 *   ACES(c) = clamp(OUT · fit(IN · c · exposure / 0.6)),
 *   fit(v)  = (v² + 0.0245786·v − 0.000090537) / (v·((v + 0.432951)·0.983729) + 0.238081)
 * 1. z = OUT⁻¹ · d: what fit() must return (0 ≤ z ≤ 1 for any d in 0…1: OUT⁻¹ has positive entries
 *    and rows summing to 1, to 10⁻⁵).
 * 2. Per channel, fit(v) = z is the quadratic (1 − b₂z)v² + (a₁ − b₁z)v − (a₀ + b₀z) = 0; its root
 *    ≥ 0 is v = 2(a₀ + b₀z) / (√disc + a₁ − b₁z) (the conjugate form of the quadratic formula: no
 *    division by 1 − b₂z, which nears 0 for white, and no cancellation for small z).
 * 3. c·exposure = 0.6 · IN⁻¹ · v, then divided by the exposure of the moment (it follows the time
 *    of day: the renderer's toneMappingExposure, the same node the output pass reads).
 * Out of gamut: ACES desaturates bright colours, and some it cannot reach from any non-negative
 * radiance (the green lamp 0x19e6b4 above 57 % of its brightness, the amber 0xffc21a above 59 %:
 * IN⁻¹ · v has a negative channel). Those channels are clamped to 0, which keeps the lightness
 * and gives up some saturation (the green LED's dots show (149, 228, 181) for (25, 230, 180)).
 * Why not darken to the edge of the gamut instead (keeping the hue and saturation): it is further
 * off perceptually (OKLab ΔE 0.145 for the green, 0.139 for the amber, against 0.072 and 0.023
 * clamped; the best any radiance does is 0.049 and 0.020), and it would take the green lamp below
 * the night bloom's threshold.
 * Why not draw these after the tone mapping (as WebGL did): the frame is tone-mapped once at the end
 * (bloom, blur, wipers, interior and glass are composed before it in HDR), and drawing lamps over
 * the finished picture would put them over the cab and in front of the glass.
 */

/** three's ACESInputMat and ACESOutputMat, in rows as its mat3() takes nine numbers (Matrix3.set). */
const ACES_IN = new Matrix3().set(
  0.59719,
  0.35458,
  0.04823,
  0.076,
  0.90834,
  0.01566,
  0.0284,
  0.13383,
  0.83777,
);
const ACES_OUT = new Matrix3().set(
  1.60475,
  -0.53108,
  -0.07367,
  -0.10208,
  1.10813,
  -0.00605,
  -0.00327,
  -0.07276,
  1.07602,
);
const FROM_OUT = ACES_OUT.clone().invert();
const FROM_IN = ACES_IN.clone().invert();
/**
 * fit(v) = (v² + A1·v − A0) / (B2·v² + B1·v + B0), as three's TSL writes it: its denominator is
 * v·((v + 0.432951)·0.983729) + 0.238081, so B1 is 0.432951 × 0.983729 (the GLSL chunk's
 * v·(0.983729·v + 0.432951) + 0.238081 differs; the WebGPU renderer runs the TSL one).
 */
const A1 = 0.0245786;
const A0 = 0.000090537;
const B2 = 0.983729;
const B1 = 0.432951 * 0.983729;
const B0 = 0.238081;
/**
 * Half a display step, in linear: a colour this close to black is drawn with less radiance, down
 * to 0 for black. Why: ACES shows radiance up to its toe (~0.002 / exposure) as black, so the exact
 * inverse of black is the toe, and an additive sprite would lay that over its whole quad.
 */
export const NEAR_BLACK = 0.5 / 255 / 12.92;
/** The most radiance returned: inside half float (65504), as the sky's sun disc (skyShader.ts). */
export const RADIANCE_MAX = 60000;
/** The smallest exposure divided by (the exposure is 0.8–1.4 in the game; this keeps it finite). */
const MIN_EXPOSURE = 1e-4;

type Rgb = readonly [number, number, number];

const apply = (m: Matrix3, v: Rgb): [number, number, number] => {
  // Matrix3.elements is column-major.
  const e = m.elements;
  return [
    e[0] * v[0] + e[3] * v[1] + e[6] * v[2],
    e[1] * v[0] + e[4] * v[1] + e[7] * v[2],
    e[2] * v[0] + e[5] * v[1] + e[8] * v[2],
  ];
};

/** Step 2 for one channel: fit's input for its output z (z ≤ 1). */
const fitInput = (z: number): number => {
  const b = A1 - B1 * z;
  const c = A0 + B0 * z;
  const disc = Math.max(b * b + 4 * (1 - B2 * z) * c, 0);
  return (2 * c) / Math.max(Math.sqrt(disc) + b, 1e-6);
};

/**
 * The exposed radiance (radiance × exposure) whose ACES is `display` (linear sRGB, clamped to 0…1),
 * before the out-of-gamut channels are clamped: a negative channel means ACES cannot show it.
 */
export function acesInverse(display: Rgb): [number, number, number] {
  const shown = display.map((x) => Math.min(Math.max(x, 0), 1)) as unknown as Rgb;
  const v = apply(FROM_OUT, shown).map(fitInput) as unknown as Rgb;
  return apply(FROM_IN, v).map((x) => x * 0.6) as [number, number, number];
}

/** What `untonemapped()` computes in the shader, for the tests: the radiance to draw. */
export function displayToRadiance(display: Rgb, exposure: number): [number, number, number] {
  const brightest = Math.max(...display.map((x) => Math.min(Math.max(x, 0), 1)));
  const fade = Math.min(brightest / NEAR_BLACK, 1);
  const e = Math.max(exposure, MIN_EXPOSURE);
  return acesInverse(display).map((x) => Math.min((Math.max(x, 0) * fade) / e, RADIANCE_MAX)) as [
    number,
    number,
    number,
  ];
}

/**
 * The radiance to draw so that the frame's ACES + sRGB output shows `display` (the linear colour a
 * `toneMapped: false` material would have shown; above 1 shows as 1, as the 8-bit canvas did).
 * The same steps as acesInverse() and displayToRadiance(), which the tests check against a copy of
 * three's ACES.
 */
export function untonemapped(
  display: Node<"vec3">,
  exposure: Node<"float"> = toneMappingExposure as unknown as Node<"float">,
): Node<"vec3"> {
  const shown = saturate(display);
  const z = mat3(FROM_OUT).mul(shown);
  const b = vec3(A1).sub(z.mul(B1));
  const c = z.mul(B0).add(A0);
  const disc = max(b.mul(b).add(vec3(1).sub(z.mul(B2)).mul(c).mul(4)), vec3(0));
  const v = c.mul(2).div(max(sqrt(disc).add(b), vec3(1e-6)));
  const exposed = max(mat3(FROM_IN).mul(v), vec3(0)).mul(0.6);
  const fade = min(max(shown.x, max(shown.y, shown.z)).div(NEAR_BLACK), 1);
  return min(exposed.mul(fade).div(max(exposure, MIN_EXPOSURE)), vec3(RADIANCE_MAX));
}

/**
 * A MeshBasicMaterial whose colour (colour × map × instance colour) shows on screen as it is,
 * whatever the exposure: the WebGL `toneMapped: false`. Fog still mixes it toward the haze, in
 * radiance like everything else (WebGL mixed it with a tone-mapped fog colour to the same end).
 */
export class UntonemappedBasicMaterial extends MeshBasicNodeMaterial {
  override setupLighting(builder: NodeBuilder): Node {
    // How: the basic lighting's result (the diffuse colour, all it has here) is the wanted display
    // colour; the radiance replaces it before the fog and the output.
    return untonemapped(super.setupLighting(builder) as Node<"vec3">);
  }

  override customProgramCacheKey(): string {
    // setupLighting is not a node property, so three's key would not tell this material apart.
    return `${super.customProgramCacheKey()}:untonemapped`;
  }
}
