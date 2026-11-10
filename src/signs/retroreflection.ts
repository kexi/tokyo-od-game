/**
 * How bright a retroreflective sign face is in the player's own headlamps: the model the sign face
 * material (src/world/signFaceMaterial.ts) draws, written here as plain arithmetic so it can be
 * tested and read back by the review hooks. The shader is a line-by-line copy of retroWhite().
 *
 * Luminance of white sheeting, per lamp: L = R_A(α, β) · I(h, v) / d², summed over the two lamps,
 * where α is the observation angle (lamp → face → eye), β the entrance angle (lamp vs the face's
 * normal), I the lamp's intensity towards the face and d its distance. A coloured part of the face
 * reflects its own share: the linear albedo of the artwork (its luminance matches the R_A ratios of
 * the colours to white within 12 %, see retroStandards.ts SHEETING_RA). The game then draws a saturating
 * `RETRO_MAX · L / (L + RETRO_HALF)` over the albedo, dimmed by a wet face.
 *
 * Why not a real light per sign (a reflector light at each plate): three evaluates every light in
 * every material and recompiles all of them when the count changes
 * (knowledge/street-lighting-and-wet-roads.md). Here each face computes its own return from two
 * shared uniforms (the lamps), so the cost is a few dozen ALU per sign fragment and nothing else.
 */
import { ENT_POWER, LAMP, OBS_FALLOFF, RETRO_HALF, RETRO_MAX, WET_RETRO } from "./retroAssumptions";
import { SHEETING_RA } from "./retroStandards";

export type Vec3 = { x: number; y: number; z: number };
export type Beam = "low" | "high";

/** R_A of white at the table's best geometry (0.2°, 5°): the model's 1. */
export const RA_PEAK = SHEETING_RA.value.find((r) => r.obsDeg === 0.2 && r.entDeg === 5)?.white ?? Number.NaN;
/** Below this observation angle the table gives no lower row: R_A is held at its 0.2° value. */
const OBS_FLOOR_DEG = 0.2;
const ENT_FLOOR_DEG = 5;
const DEG = Math.PI / 180;
const COS_ENT_FLOOR = Math.cos(ENT_FLOOR_DEG * DEG);

/** R_A of white relative to its peak, by observation and entrance angle (degrees). */
export function retroCoefficient(obsDeg: number, entDeg: number): number {
  const obs = Math.exp(-OBS_FALLOFF.value * Math.max(obsDeg - OBS_FLOOR_DEG, 0));
  const cosEnt = Math.max(Math.cos(entDeg * DEG), 0);
  const ent = Math.min((cosEnt / COS_ENT_FLOOR) ** ENT_POWER.value, 1);
  return obs * ent;
}

const gauss = (x: number, w: number) => Math.exp(-((x / w) ** 2));
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** One lamp's intensity towards (hDeg, vDeg), cd. */
export function lampIntensity(hDeg: number, vDeg: number, beam: Beam): number {
  const { low, high } = LAMP.value;
  const cut = low.cutDeg + (low.kickDeg - low.cutDeg) * smoothstep(0, low.kickWidthDeg, hDeg);
  const below = 1 - smoothstep(cut - 0.7, cut + 0.7, vDeg);
  const dipped =
    low.glareCd * gauss(hDeg, low.glareSpreadDeg) + low.peakCd * below * gauss(hDeg, low.spreadDeg);
  const isHigh = beam === "high";
  if (!isHigh) return dipped;
  return (
    high.floorCd * gauss(hDeg, high.floorSpreadDeg) +
    high.peakCd * gauss(hDeg, high.spreadDeg) * gauss(vDeg, high.riseDeg)
  );
}

/** What the lamps are at the moment the face is drawn (world frame). */
export type Lamps = {
  positions: readonly Vec3[];
  /** The car's forward and up (unit). */
  forward: Vec3;
  up: Vec3;
  beam: Beam;
};

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
/** a × b (right-handed). */
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/**
 * Luminance of white sheeting at `point` (facing `normal`, unit) as seen from `eye`, cd/m². The
 * observation angle is 2·asin(|l − v| / 2) (exact, and steadier near 0 than acos of a dot product
 * in the shader's 32-bit floats).
 */
export function retroWhite(lamps: Lamps, point: Vec3, normal: Vec3, eye: Vec3): number {
  const toEye = sub(eye, point);
  const v = scale(toEye, 1 / Math.max(len(toEye), 1e-6));
  // +X of the car is its left (carModel.ts): up × forward.
  const left = cross(lamps.up, lamps.forward);
  let sum = 0;
  for (const p of lamps.positions) {
    const toLamp = sub(p, point);
    const d = Math.max(len(toLamp), 1e-6);
    const l = scale(toLamp, 1 / d);
    const obsDeg = (2 * Math.asin(Math.min(len(sub(l, v)) / 2, 1))) / DEG;
    const entDeg = Math.acos(Math.min(Math.max(dot(normal, l), -1), 1)) / DEG;
    const out = scale(l, -1);
    const hDeg = Math.atan2(dot(out, left), dot(out, lamps.forward)) / DEG;
    const vDeg = Math.asin(Math.min(Math.max(dot(out, lamps.up), -1), 1)) / DEG;
    const near = Math.max(d, LAMP.value.nearM);
    const isFacing = dot(normal, l) > 0;
    if (!isFacing) continue;
    sum +=
      RA_PEAK * retroCoefficient(obsDeg, entDeg) * (lampIntensity(hDeg, vDeg, lamps.beam) / (near * near));
  }
  return sum;
}

/** What the material adds over the albedo for a white luminance `L`, wet share `wetness` (0–1). */
export function retroEmission(L: number, wetness: number): number {
  const wet = 1 + (WET_RETRO.value - 1) * Math.min(Math.max(wetness, 0), 1);
  return ((RETRO_MAX.value * L) / (L + RETRO_HALF.value)) * wet;
}
