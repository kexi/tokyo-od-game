/**
 * The 案内標識's letters and places as the law and the standards write them, each with where it is
 * written (the Statute form of src/law/roadStandards.ts). The layouter (src/signs/board/) and the
 * planner (src/world/guidePlan.ts) read these; the game's own choices are boardAssumptions.ts.
 * knowledge/sign-system.md「案内標識のレイアウタ（G5）」 has the readings.
 */
import type { Statute } from "../law/roadStandards";

/**
 * 文字の大きさ by the road's design speed, cm (ローマ字 half of it): 70 km/h or more 30, 40・50・60
 * 20, 30 or less 10.
 */
export const LETTER_BY_SPEED: Statute<{ upTo30: number; from40to60: number; atLeast70: number }> = {
  value: { upTo30: 10, from40to60: 20, atLeast70: 30 },
  source: "道路標識、区画線及び道路標示に関する命令 別表第二 備考一(五)2 の表",
};

/** 「必要がある場合」 the letters may be enlarged 1.5, 2, 2.5 or 3 times, and by nothing between. */
export const LETTER_ENLARGEMENTS: Statute<readonly number[]> = {
  value: [1, 1.5, 2, 2.5, 3],
  source: "同 備考一(五)2 ただし書",
};

/**
 * The enlargement 国土交通省 uses on wide roads: 片側2車線以上 15・30・30 cm for ≤ 30, 40–60 and
 * ≥ 70 km/h (片側1車線 10・20・30), i.e. 1.5 times below 70 km/h. Practice, within the 1.5 step the
 * 命令 allows.
 */
export const WIDE_ROAD_ENLARGEMENT: Statute<{ minLanes: number; times: number; belowSpeed: number }> = {
  value: { minLanes: 2, times: 1.5, belowSpeed: 70 },
  source: "国土交通省「案内標識に関するQ&A」Q&A4（文字の大きさ）",
};

/** ローマ字 are half the 日本字 (the capitals: 国土交通省 Q&A4 reads it so). */
export const ROMAN_RATIO: Statute<number> = {
  value: 0.5,
  source: "同 備考一(五)2（ローマ字にあつては、その二分の一）",
};

/** 108の3・108の4: the letters inside the arrow (the 通称名 box) are 0.6 of those outside. */
export const IN_ARROW_RATIO: Statute<number> = { value: 0.6, source: "同 備考一(五)3" };

/** 都市高速の「方面及び方向」: a route symbol at most 1.6 (経由路線) / 0.9 (方面) of the 日本字. */
export const ROUTE_SYMBOL_RATIO: Statute<{ via: number; destination: number }> = {
  value: { via: 1.6, destination: 0.9 },
  source: "同 備考一(五)6",
};

/** Where each guide sign stands (別表第一 「設置場所」), in metres before or after the junction. */
export const GUIDE_PLACES: Statute<{
  /** 105-A〜C: 交差点の手前 30 m 以内. */
  directionDistance: { maxBeforeM: number };
  /** 108-A・108の3: 300 m 以内 before the junction. */
  advance: { maxBeforeM: number };
}> = {
  value: { directionDistance: { maxBeforeM: 30 }, advance: { maxBeforeM: 300 } },
  source:
    "同 別表第一 105-A〜C「高速道路等以外の道路の交差点の手前三十メートル以内の地点における左側の路端、車道の上方…」・108-A・B「…交差点の手前三百メートル以内…」",
};

/**
 * Colours (備考一(三)1): 105 白字・青地 (an expressway's name on green), 106 on an ordinary road
 * 白字・青地, on an expressway 緑地; 108 white on blue, the expressway names on green.
 */
export const GUIDE_COLOURS: Statute<{ blue: string; green: string; white: string }> = {
  // Hues: the junction-name plates' blue (trafficControl.ts) and guideArt's green, as before G5.
  value: { blue: "#1d4f9c", green: "#0a7d4f", white: "#ffffff" },
  source: "同 備考一(三)1(11)・(12)・(13)（色の名前。色度は JIS Z 9101 で、値はゲームの近似）",
};
