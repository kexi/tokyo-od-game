import {
  IN_ARROW_RATIO,
  LETTER_BY_SPEED,
  LETTER_ENLARGEMENTS,
  ROMAN_RATIO,
  WIDE_ROAD_ENLARGEMENT,
} from "../boardStandards";

/**
 * Letter heights of a 案内標識 from the declarations of boardStandards.ts: the 命令's band by design
 * speed, enlarged by one of its steps (1.5 times below 70 km/h on a road of two lanes or more each
 * way, 国土交通省's practice), ローマ字 half, the 通称名 inside an arrow 0.6.
 */

/** The 命令's 文字の大きさ for a design speed, cm (before any enlargement). */
export function baseLetter(designSpeed: number): number {
  const table = LETTER_BY_SPEED.value;
  if (designSpeed <= 30) return table.upTo30;
  if (designSpeed < 70) return table.from40to60;
  return table.atLeast70;
}

/** The enlargement step for a road (1 when none): only steps the 命令 lists. */
export function enlargement(designSpeed: number, lanes: number): number {
  const rule = WIDE_ROAD_ENLARGEMENT.value;
  const isWide = lanes >= rule.minLanes && designSpeed < rule.belowSpeed;
  const times = isWide ? rule.times : 1;
  // A step the 命令 does not list would be a misread rule: keep the nearest smaller one.
  return LETTER_ENLARGEMENTS.value.filter((s) => s <= times).at(-1) ?? 1;
}

/**
 * 漢字 height (cm) by design speed and lanes: 片側2車線以上 15 / 30 / 30 cm for ≤ 30, 40–60, ≥ 70 km/h,
 * 片側1車線 10 / 20 / 30.
 */
export function letterHeight(designSpeed: number, lanes: number): number {
  return baseLetter(designSpeed) * enlargement(designSpeed, lanes);
}

/** ローマ字 (the capitals) for a 日本字 height. */
export const romanHeight = (letter: number) => letter * ROMAN_RATIO.value;

/** The 通称名 inside an arrow (108の3・108の4) for a 日本字 height. */
export const inArrowHeight = (letter: number) => letter * IN_ARROW_RATIO.value;
