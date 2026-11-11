/**
 * Values the expressway compiler needs that no statute fixes. Kept apart from src/law/roadStandards.ts
 * so a guess never passes for a 構造令 value: every entry says `verified: false` and why it is what it
 * is. When a real figure is found (a design manual, a survey), change the value, cite it and flip
 * `verified`; the compiler reads nothing else.
 */

export type Assumption<T> = { readonly value: T; readonly verified: false; readonly reason: string };

/** Depth from the road surface to the soffit of the box girder (slab + girder). */
export const GIRDER_DEPTH: Assumption<number> = {
  value: 2.2,
  verified: false,
  reason: "未確認。都市高架の鋼箱桁・PC 箱桁の桁高 1.8〜2.5 m 程度という一般的な目安から置いた",
};

/** Standard clearance under the girder where nothing forces it higher: the viaduct's target height. */
export const STANDARD_UNDERCLEARANCE: Assumption<number> = {
  value: 6.5,
  verified: false,
  reason: "未確認。建築限界 4.5 m（第12条）に余裕を足した値。首都高の実際の桁下高の分布は調べていない",
};

/** Clearance over a railway (the overhead line), in place of 第12条's 4.5 m which is for roads. */
export const RAIL_CLEARANCE: Assumption<number> = {
  value: 6.0,
  verified: false,
  reason: "未確認。鉄道の建築限界と架空電車線の高さ（約 5〜5.7 m）に余裕を見た値",
};

/** Clearance over water (navigation), when a viaduct crosses a river or canal. */
export const WATER_CLEARANCE: Assumption<number> = {
  value: 4.5,
  verified: false,
  reason: "未確認。航路限界は河川ごとに違い調べていない。道路の建築限界と同じ値を仮に使う",
};

/** Spacing of the piers along the line (distance, from the run's start). */
export const PIER_SPACING: Assumption<number> = {
  value: 35,
  verified: false,
  reason: "未確認。都市高架の支間 30〜40 m 程度という一般的な目安",
};

/** Height of the 壁高欄 (concrete parapet) above the deck. */
export const PARAPET_HEIGHT: Assumption<number> = {
  value: 1.1,
  verified: false,
  reason: "未確認。防護柵の設置基準の高さの目安（0.9〜1.1 m 程度）から。種別 SS などは調べていない",
};

/** Width of the 壁高欄 itself and the deck beyond the shoulder (the curb of the slab). */
export const PARAPET_WIDTH: Assumption<number> = {
  value: 0.5,
  verified: false,
  reason: "未確認。壁高欄の天端幅の目安",
};

/** Side friction f in e = V²/(127R) − f. */
export const SIDE_FRICTION: Assumption<number> = {
  value: 0.15,
  verified: false,
  reason: "未確認。設計速度 40〜60 km/h の横すべり摩擦係数の一般的な値（0.13〜0.15）から",
};

/** Smallest radius a ramp may keep after smoothing (28条4項 frees ramps from 第15条). */
export const RAMP_MIN_RADIUS: Assumption<number> = {
  value: 15,
  verified: false,
  reason:
    "knowledge/road-redesign-plan.mdの判断（走行できる下限）。法令値ではない（第15条の V20 の値と同じ）",
};

/** How far the smoothed centre line may move away from the OSM line. */
export const MAX_LATERAL_SHIFT: Assumption<number> = {
  value: 1.5,
  verified: false,
  reason: "knowledge/road-redesign-plan.mdの判断。OSM の位置精度と車線幅の半分未満という目安",
};

/** Lanes and design speed when OSM has no lanes / maxspeed. */
export const DEFAULT_LANES: Assumption<{ main: number; ramp: number }> = {
  value: { main: 2, ramp: 1 },
  verified: false,
  reason: "knowledge/road-redesign-plan.md 4.1 の既定。OSM の lanes が無い way の実態は調べていない",
};

export const DEFAULT_SPEED: Assumption<{ main: number; ramp: number }> = {
  value: { main: 60, ramp: 40 },
  verified: false,
  reason: "knowledge/road-redesign-plan.md 4.1 の既定（法定速度 60、ランプは 40）",
};

/** Lane width, shoulders and design speed table used for ramps (statute frees them: 28条4項). */
export const RAMP_SECTION: Assumption<{ laneWidth: number; shoulderL: number; shoulderR: number }> = {
  value: { laneWidth: 3.25, shoulderL: 1.0, shoulderR: 0.5 },
  verified: false,
  reason: "未確認。連結路は第5・8条の適用外。第二種第二級の車線幅と狭めた路肩を仮に使う",
};

/** Half width of a ground road crossed under a viaduct, to keep piers off its carriageway. */
export const GROUND_ROAD_HALF_WIDTH: Assumption<number> = {
  value: 6,
  verified: false,
  reason: "未確認。OSM に幅が無いので 2〜4 車線の一般道の半幅の目安",
};

/**
 * Lane-line dash and gap inside 標識令's ranges (3〜10 m, 1〜2 times). 8 m / 12 m is within them; the
 * value actually painted on urban expressways is not confirmed.
 */
export const LANE_LINE_DASH: Assumption<{ dash: number; gap: number }> = {
  value: { dash: 8, gap: 12 },
  verified: false,
  reason: "未確認。令の範囲内の値。実務値は調べていない",
};

export const ASSUMPTIONS: Readonly<Record<string, Assumption<unknown>>> = {
  GIRDER_DEPTH,
  STANDARD_UNDERCLEARANCE,
  RAIL_CLEARANCE,
  WATER_CLEARANCE,
  PIER_SPACING,
  PARAPET_HEIGHT,
  PARAPET_WIDTH,
  SIDE_FRICTION,
  RAMP_MIN_RADIUS,
  MAX_LATERAL_SHIFT,
  DEFAULT_LANES,
  DEFAULT_SPEED,
  RAMP_SECTION,
  GROUND_ROAD_HALF_WIDTH,
  LANE_LINE_DASH,
};
