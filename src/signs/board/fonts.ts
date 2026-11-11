import type { Measure, SignName } from "./boxes";
import { romanHeight } from "./letters";

/**
 * The board fonts as CSS font strings, and the widths of names measured with them. Noto Sans JP and
 * Overpass are subset by scripts/textures/guide_fonts.py and loaded by src/world/guideArt.ts under
 * these family names; the system's gothic stands in until they load.
 */
export const JP = `GuideJP, "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif`;
export const LATIN = `GuideLatin, "Helvetica Neue", Arial, sans-serif`;
/** Overpass's capital height is 0.70 em: the font size that makes capitals a given height. */
export const LATIN_CAP = 0.7;
/** px per cm the layout measures at (the widths are then divided back to cm). */
export const MEASURE_K = 4;

export const jpFont = (cm: number, k: number) => `700 ${Math.round(cm * k)}px ${JP}`;
export const latinFont = (cm: number, k: number) => `700 ${Math.round((cm / LATIN_CAP) * k)}px ${LATIN}`;

/** Two-character names are spaced out as on the real boards (「上 馬」「大 森」, 図 016). */
export const spacedName = (n: SignName) =>
  n.ja.length === 2 && !n.expressway ? `${n.ja[0]} ${n.ja[1]}` : n.ja;

/** 漢字, a gap, the English line. */
export const NAME_H = (h: number) => 1.75 * h;

/** Width (cm) of a name block: the wider of its Japanese and its English (half height). */
export function nameWidth(measure: Measure, n: SignName, h: number): number {
  const k = MEASURE_K;
  const jp = measure(jpFont(h, k), spacedName(n)) / k;
  const en = n.en ? measure(latinFont(romanHeight(h), k), n.en) / k : 0;
  return Math.max(jp, en) + (n.expressway ? 0.5 * h : 0);
}

/** Width (cm) of a text in one of the fonts at a height. */
export function textWidth(measure: Measure, font: "jp" | "latin", cm: number, text: string): number {
  const k = MEASURE_K;
  return measure(font === "jp" ? jpFont(cm, k) : latinFont(cm, k), text) / k;
}
