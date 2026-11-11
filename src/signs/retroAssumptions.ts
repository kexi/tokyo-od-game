/**
 * Values the sign faces' retroreflection needs that no specification fixes: the game's choices, each
 * `verified: false` with why it is what it is (the form of src/signs/mountAssumptions.ts). When a
 * real figure is found, change the value, cite it, and move it to retroStandards.ts.
 */
import type { Assumption } from "../expressway/assumptions";

/** exp(−k (α − 0.2°)): least squares in log over the white rows at 0.33° and 2.0° (5° entrance). */
export const OBS_FALLOFF: Assumption<number> = {
  value: 2.2,
  verified: false,
  reason:
    "表2-2-29 の白の 0.33°（180/250 = 0.72）と 2.0°（5/250 = 0.02）に指数で合わせた値（/度）。2° より大きい観測角は表に無く、同じ傾きで延ばした仮定",
};

/** (cos β / cos 5°)^p: fitted to the white rows at 30° (0.60) and 40° (0.44). */
export const ENT_POWER: Assumption<number> = {
  value: 3.3,
  verified: false,
  reason: "表2-2-29 の白の入射角 30°・40° の比に合わせた冪。40° より大きい入射角は表に無い",
};

/**
 * The two headlamps' light distribution, cd per lamp, by the angle left of the car's axis `hDeg`
 * (+ = left, the kerb side under 左側通行) and above its horizon `vDeg`.
 * - すれ違い用: a cut-off 0.6° below the horizon on the oncoming side, raised to 1.0° above it over
 *   the first 15° to the left (the kick-up that lights the kerb and its signs), 15,000 cd under it,
 *   400 cd of glare above.
 * - 走行用: 30,000 cd on the axis, falling to half 8.3° aside and 4.2° up or down, over 1,500 cd.
 */
export const LAMP: Assumption<{
  low: {
    peakCd: number;
    glareCd: number;
    cutDeg: number;
    kickDeg: number;
    kickWidthDeg: number;
    spreadDeg: number;
    glareSpreadDeg: number;
  };
  high: { peakCd: number; floorCd: number; spreadDeg: number; riseDeg: number; floorSpreadDeg: number };
  nearM: number;
}> = {
  value: {
    low: {
      peakCd: 15000,
      glareCd: 400,
      cutDeg: -0.6,
      kickDeg: 1.0,
      kickWidthDeg: 15,
      spreadDeg: 22,
      glareSpreadDeg: 30,
    },
    high: { peakCd: 30000, floorCd: 1500, spreadDeg: 10, riseDeg: 5, floorSpreadDeg: 30 },
    nearM: 3,
  },
  verified: false,
  reason:
    "未確認。配光の数値は ECE R112 の形（左側通行の上向きのカットオフ、走行用の中心の山）を借りた目安で、道路運送車両の保安基準 第32条は「すれ違い用 40 m・走行用 100 m 先の障害物を確認できる」としか書かない。nearM は距離の逆 2 乗を頭打ちにする距離（ゲームの値）",
};

/**
 * The most the return adds to the albedo (white, pre-exposure). With the night base glow (0.05)
 * and the 0.8 night exposure a white face stays at 0.28, under where the night bloom's knee starts
 * (threshold 0.55 × (1 − 0.35) = 0.36, knowledge/sky-light-and-bloom.md).
 */
export const RETRO_MAX: Assumption<number> = {
  value: 0.3,
  verified: false,
  reason:
    "見た目の値。白い板の上限を、下駄 0.05 と合わせて夜の露出 0.8 の後に 0.28 とし、ブルームの膝（閾値 0.55 × 0.65 = 0.36）より下に置く。最初の 0.6 は露出後 0.48 で膝に入る値だった（knowledge/sign-system.md）",
};

/** Luminance (cd/m²) at which the return reaches half of RETRO_MAX. */
export const RETRO_HALF: Assumption<number> = {
  value: 5,
  verified: false,
  reason:
    "見た目の値。暗順応した目で、ロービームの 30 m（白 4〜8 cd/m²）は上限の半分ほど（G3 前の一律の 0.18 と同じくらいの明るさ）、ハイビームの 30〜60 m（数十〜数百 cd/m²）はほぼ上限になるように置いた",
};

/** The return of a wet face, relative to dry. */
export const WET_RETRO: Assumption<number> = {
  value: 0.6,
  verified: false,
  reason:
    "未確認。雨で表面に水の膜が付くと再帰反射が落ちる（設計書 6 章の仮定値）。濡れの度合い env.wetness で 1 から下げる",
};

/** The darkness (env.nightFactor, 0–1) over which the eye adapts and starts to see the return. */
export const DARK_ADAPT: Assumption<{ from: number; to: number }> = {
  value: { from: 0.15, to: 0.6 },
  verified: false,
  reason:
    "見た目の値。夕方の薄明（nightFactor 0.15）から効き始め、街灯が主になる 0.6 で全部。昼に前照灯を点けても板が光らないようにする",
};

/** Self-illumination of a face by day (× albedo): the flat glow the plates had before G3. */
export const BASE_GLOW: Assumption<{ plates: number; guide: number }> = {
  value: { plates: 0.18, guide: 0.16 },
  verified: false,
  reason:
    "G3 前の MeshStandardMaterial の emissiveIntensity（規制 0.18、案内の近い板 0.16）。昼の見えを変えないために残す。街灯の光が板に当たらない（街灯は路面だけの uniform）ことの埋め合わせ",
};

/** The base glow's share at full night (0.18 × 0.28 = 0.05 of the albedo for the plates). */
export const NIGHT_BASE: Assumption<number> = {
  value: 0.28,
  verified: false,
  reason:
    "見た目の値。前照灯の外の板は暗く（夜の 8 m 正面で読める程度）、前照灯の中との差が見えるように下げた。設計の「街灯の明るさに連動する下駄」ではなく nightFactor に連動（街灯の光は板に届いていない）",
};

/**
 * The driver's eye in the car's frame (m, +X left, +Y up, +Z forward), used when the cockpit model
 * (its DriverEye node) is not loaded.
 */
export const DRIVER_EYE: Assumption<{ x: number; y: number; z: number }> = {
  value: { x: -0.37, y: 0.63, z: -0.1 },
  verified: false,
  reason:
    "未確認。右ハンドルの運転席（車の右 = −X）、路面から約 1.2 m（車の原点は約 0.57 m）、前照灯（z 2.1）の約 2.2 m 後ろ。cockpit.glb の DriverEye が読めればそちらを使う",
};

/** Every assumption here, for the tests (each must say why it is what it is). */
export const ASSUMPTIONS: Readonly<Record<string, Assumption<unknown>>> = {
  OBS_FALLOFF,
  ENT_POWER,
  LAMP,
  RETRO_MAX,
  RETRO_HALF,
  WET_RETRO,
  DARK_ADAPT,
  BASE_GLOW,
  NIGHT_BASE,
  DRIVER_EYE,
};
