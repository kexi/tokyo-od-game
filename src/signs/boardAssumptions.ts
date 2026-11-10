/**
 * Values the 105・106 boards need that no standard fixes: the game's choices, each `verified: false`
 * with why it is what it is (the Assumption form of src/expressway/assumptions.ts). When a real
 * figure is found, change the value, cite it and move it to boardStandards.ts.
 */
import type { Assumption } from "../expressway/assumptions";

/** 106-A 確認標識: metres past the junction's centre it is tried at, in this order. */
export const CONFIRM_AFTER: Assumption<readonly number[]> = {
  value: [80, 100, 120, 140, 160, 180, 200, 60],
  verified: false,
  reason:
    "未確認。別表第一は「設置を必要とする地点」だけで距離を定めない。交差点を出て流れが落ち着いた所（交差点の先で、次の交差点の 108の2 の 55〜140 m と重なりにくい所）の目安",
};

/** 106-A: two boards for the same traffic stand at least this far apart, m. */
export const CONFIRM_SPACING: Assumption<number> = {
  value: 800,
  verified: false,
  reason:
    "未確認。主要な交差点ごとに立てると 23 区の幹線では数百 m おきになり、板が並びすぎる。1 km 前後の間隔の目安",
};

/** Road distance beyond the traced road: the straight distance times this. */
export const ROAD_DETOUR: Assumption<number> = {
  value: 1.2,
  verified: false,
  reason:
    "未確認。道路網の外は直線距離しか分からない。23 区の幹線の道のり／直線の比の目安（板の km は整数に丸めるので、1 割の差は数 km 先で 1 変わる程度）",
};

/** 105: metres before the stop line it is tried at (別表第一: 交差点の手前 30 m 以内). */
export const DIRECTION_BACKS: Assumption<readonly number[]> = {
  value: [20, 15, 25, 10],
  verified: false,
  reason:
    "未確認。30 m 以内（別表第一）は交差点の中心からではなく停止線からとし、中心までの距離を足しても収まりやすい所から試す",
};

/** 106-A: places named at most (the figure shows two; Tokyo's boards often three). */
export const CONFIRM_ROWS: Assumption<number> = {
  value: 3,
  verified: false,
  reason:
    "未確認。別表第二の図は 2 地名。23 区の国道の確認標識は 3 地名のものが多い（目視の記憶で、数えていない）",
};
