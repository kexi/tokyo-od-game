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

/**
 * The floor over open ground (no road crossed there in OSM): the girder underside at least 第12条's
 * 4.5 m over the ground, as if any ground could hold a road. Not the 6.5 m target height
 * (STANDARD_UNDERCLEARANCE): the floor below which a deck counts as too low.
 */
export const OPEN_GROUND_FLOOR: Assumption<number> = {
  value: 4.5,
  verified: false,
  reason:
    "仮定。第12条の建築限界 4.5 m を、OSM に道路の無い地表全体にも当てはめた（未登録の道路がありうるとして）",
};

/**
 * How far a run that fails at its lowest design speed may still miss OPEN_GROUND_FLOOR and count as
 * solved (the last fallback step, with the amount reported as below_open_ground_floor).
 */
export const OPEN_FLOOR_GIVE: Assumption<number> = {
  value: 0.5,
  verified: false,
  reason:
    "仮定。値は第12条ただし書（第三種第五級でやむを得ない場合の H 4 m）から借りた: 桁下 4.0 m。23 区の都市高速の下の地表に第三種第五級の道路があるという根拠ではない",
};

/** How far the deck may sit in the smoothed DEM near a low end (the floor there is DEM − this). */
export const DEM_SINK_FLOOR: Assumption<number> = {
  value: 0.25,
  verified: false,
  reason:
    "仮定。平滑化した DEM のすぐ上に端を合わせると、拘束点の間の数 cm の起伏で解けなくなったので置いた余裕",
};

/** How much deeper than DEM_SINK_FLOOR a run failing at its lowest speed may go (last step). */
export const DEM_SINK_GIVE: Assumption<number> = {
  value: 0.75,
  verified: false,
  reason:
    "仮定。平滑化した DEM（5×5 中央値と 3×3 の加重平均）は擁壁・盛土の段で段の半分ほどずれるので、低い端の近くでは平滑化した地表に計 1.0 m まで入るのを認めた。実測で確かめていない",
};

/** A short run's ground end may sit this far above or below the DEM there (T5 allows 5 cm). */
export const GROUND_END_BAND: Assumption<number> = {
  value: 0.04,
  verified: false,
  reason: "仮定。T5 の 5 cm から地表の丸め（1 cm）を引いた幅",
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
export const DEFAULT_LANES: Assumption<{ main: number; ramp: number; street: number }> = {
  value: { main: 2, ramp: 1, street: 2 },
  verified: false,
  reason:
    "knowledge/road-redesign-plan.md 4.1 の既定。OSM の lanes が無い way の実態は調べていない。street は構造物上書きで指名した臨港道路（P7）で、橋の上の way が lanes=2 なので取付けも 2",
};

export const DEFAULT_SPEED: Assumption<{ main: number; ramp: number; street: number }> = {
  value: { main: 60, ramp: 40, street: 40 },
  verified: false,
  reason:
    "knowledge/road-redesign-plan.md 4.1 の既定（法定速度 60、ランプは 40）。street（P7 の臨港道路）は芝浦のループの way が maxspeed=40 なので橋の上も 40 と置いた（橋の上の規制速度は確かめていない）",
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

/**
 * The thick dashed line between a main line and a ramp where they merge or part (標識令 別表第四
 * の分合流部: 幅 0.30〜0.75 m、線長 2〜5 m、間隔 線長の 1〜1.5 倍). 0.45 / 3 / 3 is within it; the value
 * painted on urban expressways is not confirmed.
 */
export const BRANCH_LINE: Assumption<{ width: number; dash: number; gap: number }> = {
  value: { width: 0.45, dash: 3, gap: 3 },
  verified: false,
  reason: "未確認。令の範囲内の値。実務値は調べていない",
};

/**
 * 導流帯 (標示 107) at a nose: outline width, stripe width and the stripes' spacing along the road.
 * The order's example figure is not transcribed yet (knowledge/road-redesign-plan.md 4.7).
 */
export const ZEBRA: Assumption<{ outline: number; stripe: number; pitch: number }> = {
  value: { outline: 0.2, stripe: 0.45, pitch: 3 },
  verified: false,
  reason: "未確認。別表の例示図から転記していない。見た目の目安",
};

export const ASSUMPTIONS: Readonly<Record<string, Assumption<unknown>>> = {
  GIRDER_DEPTH,
  STANDARD_UNDERCLEARANCE,
  OPEN_GROUND_FLOOR,
  OPEN_FLOOR_GIVE,
  DEM_SINK_FLOOR,
  DEM_SINK_GIVE,
  GROUND_END_BAND,
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
  BRANCH_LINE,
  ZEBRA,
};
