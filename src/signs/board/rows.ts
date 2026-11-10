import type { BoxNode, Measure } from "./boxes";
import type { Row, RowsContent, SignName } from "./content";
import { NAME_H, nameWidth, spacedName, textWidth } from "./fonts";
import { armVector } from "./junction";
import { romanHeight } from "./letters";

/**
 * `rows`: 105-A〜C 方面、方向及び距離 and 106-A 方面及び距離 (別表第二 図 008–011), white on blue
 * (備考一(三)1(11)・(12)), an expressway's name on green.
 *
 * - 105: a row per direction with its own arrow, white rules between the rows. The arrow stands at
 *   the side it points to (left and straight on at the left, right at the right, 図 008) and the
 *   distance at the other end of the row.
 * - 106: one arrow up the left for all the places, the farthest on top (図 011 「日本橋 10km」 over
 *   「日比谷 7km」), the distances at the right.
 *
 * Sizes not given by the figures (they carry no dimensions) are read off them in letter heights:
 * a 106 row of 2.91 letters makes the two-place board 200 cm tall at 30 cm letters, the 確認標識 of
 * 国土交通省 Q&A4 (200 × 240 cm); the figures in the distance are 0.8 of the 漢字 and "km" 0.4.
 */

const MARGIN = 0.42; // inside the rim, letter heights (as the junction diagram)
const ROW_105 = 2.5; // letter heights per row
/** Two rows and the margins make Q&A4's 200 cm at 30 cm letters: 2.91 letters a row. */
const ROW_106 = (200 / 30 - 2 * MARGIN) / 2;
const ARROW_CELL = 1.7;
const KM_DIGITS = 0.8;
const KM_UNIT = 0.4;
/** The standard width at 30 cm letters (Q&A4's 確認標識); wider when the names need it. */
const MIN_WIDTH_30 = 240;

const kmText = (km: number) => (Number.isInteger(km) ? String(km) : km.toFixed(1));

function kmWidth(measure: Measure, row: Row, h: number): number {
  if (row.km === null) return 0;
  return (
    textWidth(measure, "latin", KM_DIGITS * h, kmText(row.km)) +
    0.08 * h +
    textWidth(measure, "latin", KM_UNIT * h, "km")
  );
}

/** A name block (日本字 over its English) at (x, by), aligned at x; an expressway's on green. */
function nameBlock(
  n: SignName,
  x: number,
  by: number,
  w: number,
  h: number,
  align: "left" | "right",
): BoxNode[] {
  const out: BoxNode[] = [];
  if (n.expressway) {
    out.push({
      type: "field",
      x: align === "left" ? x - 0.2 * h : x - w - 0.2 * h,
      y: by - 0.08 * h,
      w: w + 0.4 * h,
      h: NAME_H(h) * 0.98,
      radius: 0.12 * h,
      fill: "green",
      stroke: { colour: "white", width: h / 20 },
    });
  }
  out.push({
    type: "text",
    text: spacedName(n),
    font: "jp",
    cm: h,
    x,
    y: by + 0.02 * h,
    align,
    baseline: "top",
    colour: "white",
    maxW: w,
  });
  if (n.en)
    out.push({
      type: "text",
      text: n.en,
      font: "latin",
      cm: romanHeight(h),
      x,
      y: by + 1.1 * h,
      align,
      baseline: "top",
      colour: "white",
      maxW: w,
    });
  return out;
}

/** The distance: the figures, then "km" smaller, aligned at x on the 漢字's baseline. */
function kmNodes(
  row: Row,
  x: number,
  baseline: number,
  h: number,
  align: "left" | "right",
  measure: Measure,
) {
  if (row.km === null) return [];
  const digits = kmText(row.km);
  const unitW = textWidth(measure, "latin", KM_UNIT * h, "km");
  const digitsW = textWidth(measure, "latin", KM_DIGITS * h, digits);
  const digitsRight = align === "right" ? x - unitW - 0.08 * h : x + digitsW;
  const nodes: BoxNode[] = [
    {
      type: "text",
      text: digits,
      font: "latin",
      cm: KM_DIGITS * h,
      x: digitsRight,
      y: baseline,
      align: "right",
      baseline: "alphabetic",
      colour: "white",
      maxW: null,
    },
    {
      type: "text",
      text: "km",
      font: "latin",
      cm: KM_UNIT * h,
      x: digitsRight + 0.08 * h,
      y: baseline,
      align: "left",
      baseline: "alphabetic",
      colour: "white",
      maxW: null,
    },
  ];
  return nodes;
}

const arrowIn = (cx: number, cy: number, angle: number, length: number, h: number): BoxNode => {
  const { dx, dy } = armVector(angle);
  return {
    type: "arrow",
    colour: "white",
    tail: { x: cx - (dx * length) / 2, y: cy - (dy * length) / 2 },
    tip: { x: cx + (dx * length) / 2, y: cy + (dy * length) / 2 },
    shaft: 0.3 * h,
    headW: 0.82 * h,
    headL: 0.62 * h,
  };
};

export function layoutRows(
  c: RowsContent,
  measure: Measure,
): { width: number; height: number; nodes: BoxNode[] } {
  const h = c.letter;
  const m = MARGIN * h;
  const isConfirm = c.kind === "106-A";
  const rowH = (isConfirm ? ROW_106 : ROW_105) * h;
  const cell = ARROW_CELL * h;
  const names = c.rows.map((r) => nameWidth(measure, r.name, h));
  const kms = c.rows.map((r) => kmWidth(measure, r, h));
  const need = Math.max(...c.rows.map((_, i) => m + cell + 0.4 * h + names[i] + 0.7 * h + kms[i] + m));
  const width = Math.max((MIN_WIDTH_30 * h) / 30, need);
  const height = 2 * m + c.rows.length * rowH;
  const nodes: BoxNode[] = [{ type: "background", field: "blue", letter: h }];
  if (isConfirm) {
    // One arrow up the whole left side.
    const cx = m + cell / 2;
    nodes.push(arrowIn(cx, height / 2, 0, height - 2 * m - 0.3 * h, h));
  }
  c.rows.forEach((row, i) => {
    const top = m + i * rowH;
    const by = top + (rowH - NAME_H(h)) / 2;
    const baseline = by + 0.96 * h;
    const isRight = !isConfirm && row.angle !== null && row.angle < 0;
    const hasArrow = !isConfirm && row.angle !== null;
    if (i > 0 && !isConfirm)
      nodes.push({
        type: "rule",
        from: { x: m / 2, y: top },
        to: { x: width - m / 2, y: top },
        width: h / 14,
        colour: "white",
      });
    if (hasArrow && row.angle !== null)
      nodes.push(
        arrowIn(isRight ? width - m - cell / 2 : m + cell / 2, top + rowH / 2, row.angle, 1.4 * h, h),
      );
    // The room the name may take: the row less the arrow cell, the distance and the gaps.
    const room = width - 2 * m - cell - 1.1 * h - kms[i];
    const w = Math.min(names[i], room);
    if (isRight) {
      nodes.push(...kmNodes(row, m, baseline, h, "left", measure));
      nodes.push(...nameBlock(row.name, width - m - cell - 0.4 * h, by, w, h, "right"));
    } else {
      nodes.push(...nameBlock(row.name, m + cell + 0.4 * h, by, w, h, "left"));
      nodes.push(...kmNodes(row, width - m, baseline, h, "right", measure));
    }
  });
  return { width, height, nodes };
}
