/**
 * Values the sign mounts need that no standard fixes: the game's choices, each `verified: false`
 * with why it is what it is (the Assumption form of src/expressway/assumptions.ts). When a real
 * figure is found, change the value, cite it, and move it to mountStandards.ts.
 */
import type { Assumption } from "../expressway/assumptions";

/** From a sign's foot to the carriageway edge (placeSigns, 一時停止, 横断歩道, street furniture), m. */
export const SIGN_KERB: Assumption<number> = {
  value: 0.7,
  verified: false,
  reason:
    "未確認。歩道の車道寄りに立つ柱の目安。面が車道端から 25 cm（設置基準）を保つよう 60 cm の板の半分 + 余裕",
};

/** From a 車両用 signal pole's corner spot to its approach's carriageway edge, m. */
export const SIGNAL_POLE_KERB: Assumption<number> = {
  value: 1.2,
  verified: false,
  reason: "未確認。T 系で置いた信号柱の位置（交差点の向こう側の左の角、車道端から 1.2 m）",
};

/** From a 案内標識's pole axis to the kerb line, m. */
export const GUIDE_POLE_KERB: Assumption<number> = {
  value: 0.9,
  verified: false,
  reason: "未確認。φ267.4 の F 形柱と基礎が歩道に収まる位置の目安（2026-10-05 の案内標識から）",
};

/** Highest top edge of the faces on a 60.5 mm sign post, m. */
export const POST_MAX_TOP: Assumption<number> = {
  value: 4.0,
  verified: false,
  reason: "未確認。単柱（60.5 mm）の地上の長さの目安。超える列は 2 本に分けるか、上端を上げる",
};

/** Highest top edge of a 規制 plate wider than WIDE_PLATE on two posts, m. */
export const BOARD_MAX_TOP: Assumption<number> = {
  value: 5.5,
  verified: false,
  reason: "未確認。327の7 の板（90 cm 高、1.25 倍）を歩道上 2.5 m に掛けて余る高さ",
};

/** A plate wider than this stands on two posts, m (as drawn). */
export const WIDE_PLATE: Assumption<number> = {
  value: 1.2,
  verified: false,
  reason: "未確認。1 本の柱とレールで支える板の幅の目安（60 cm の板の 2 倍）",
};

/** Between two columns of plates side by side (左右に振り分け), m. */
export const COLUMN_GAP: Assumption<number> = {
  value: 0.1,
  verified: false,
  reason: "未確認。板どうしが触れない程度の隙間",
};

/** Between an upper 本板 (or its 補助板) and the 本板 under it, m: inside PLATE_GAP_RANGE. */
export const PLATE_GAP: Assumption<number> = {
  value: 0.12,
  verified: false,
  reason: "交通規制基準の 10〜15 cm（mountStandards.ts PLATE_GAP_RANGE）の中から選んだ値",
};

/** Between a plate and the 補助標識 under it, m. */
export const AUX_GAP: Assumption<number> = {
  value: 0.06,
  verified: false,
  reason: "未確認。G2 の値（補助板は本板の直下、間隔の規定は見つけていない）",
};

/** The post reaches this far above the top face, m. */
export const POST_OVER: Assumption<number> = {
  value: 0.08,
  verified: false,
  reason: "未確認。笠と最上段のバンドが板の上に出る分",
};

/** On a signal pole, the faces stay this far under the arm (and the heads and 交差点名 on it), m. */
export const ARM_CLEAR: Assumption<number> = {
  value: 0.3,
  verified: false,
  reason: "未確認。腕の取付金具と交差点名の板に掛からない程度",
};

/** A post this close to a 車両用 signal pole for the same traffic hangs on the pole instead, m. */
export const SIGNAL_SHARE_RADIUS: Assumption<number> = {
  value: 6,
  verified: false,
  reason: "未確認。設置基準 3-1-2 (3) は近くの信号機の利用を検討するとだけ書き、距離を定めていない",
};

/** A 歩行者用灯器 this close to a 車両用 pole (horizontally) would hide plates hung beside it, m. */
export const PED_NEAR_POLE: Assumption<number> = {
  value: 1.5,
  verified: false,
  reason: "未確認。神田の交差点で灯器が下の板を隠した距離（G4 レビュー 1 周目）に余裕を見た値",
};

/** Plates on a pole next to a 歩行者用灯器 clear its housing's top by this much, m. */
export const PED_HEAD_CLEAR: Assumption<number> = {
  value: 0.1,
  verified: false,
  reason: "未確認。灯器のフードと板が触れない程度",
};

/** From the F pole's surface to the board's inner edge, m. */
export const BOARD_GAP: Assumption<number> = {
  value: 0.55,
  verified: false,
  reason: "未確認。2026-10-05 の案内標識の値（腕のフランジと板の縦桁が当たらない程度）",
};

/**
 * Radii and lengths of the unit members, as scripts/blender/signs.py and guide_signs.py model them
 * (tests/signMount.test.ts reads the scripts and src/world/trafficControl.ts to keep them equal).
 */
export const MEMBER_SIZES: Assumption<{
  postRadius: number;
  signalPoleRadius: number;
  guidePoleRadius: number;
  guidePoleHeight: number;
  guideArmRadius: number;
  guidePostRadius: number;
  guideRailOffset: number;
  gantryLegRadius: number;
  trussDepth: number;
}> = {
  value: {
    postRadius: 0.03025,
    signalPoleRadius: 0.13,
    guidePoleRadius: 0.1337,
    guidePoleHeight: 7.6,
    guideArmRadius: 0.0699,
    guidePostRadius: 0.04455,
    guideRailOffset: 0.043,
    gantryLegRadius: 0.15925,
    trussDepth: 0.8,
  },
  verified: false,
  reason:
    "未確認。一般的な STK400 の管径（60.5・φ267.4・φ139.8・φ89.1・φ318.5 mm）と 0.8 m 角のトラス。信号柱は T 系の値",
};

/** Every assumption here, for the tests (each must say why). */
export const MOUNT_ASSUMPTIONS: Readonly<Record<string, Assumption<unknown>>> = {
  SIGN_KERB,
  SIGNAL_POLE_KERB,
  GUIDE_POLE_KERB,
  POST_MAX_TOP,
  BOARD_MAX_TOP,
  WIDE_PLATE,
  COLUMN_GAP,
  PLATE_GAP,
  AUX_GAP,
  POST_OVER,
  ARM_CLEAR,
  SIGNAL_SHARE_RADIUS,
  PED_NEAR_POLE,
  PED_HEAD_CLEAR,
  BOARD_GAP,
  MEMBER_SIZES,
};
