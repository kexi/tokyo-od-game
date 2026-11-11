import { en } from "../../i18n/en";
import { ja } from "../../i18n/ja";
import type { BoxNode, Measure } from "./boxes";
import type { EntranceContent, ExitContent, ExpresswayDiagramContent, SignName } from "./content";
import { NAME_H, nameWidth, spacedName, textWidth } from "./fonts";
import { armVector, layoutJunction } from "./junction";
import { romanHeight } from "./letters";
import { ROUTE_SYMBOL_RATIO } from "../boardStandards";

/**
 * The 都市高速's green boards as templates for G6 (which places them): the branch diagram
 * (108の2-C〜E), the exits (110-B・112-B・113-A・B) and the entrances (103-A・B・104), white on green
 * with the exit number white with green figures (備考一(三)1(13)・別表第二 図 020–033).
 *
 * The name layer: the operator is the fictional 「都市高速」 by its i18n key (`guide.operator`, the
 * Japanese and English dictionaries, whatever language the player reads: a board is in both), and
 * route symbols take the form of 118の3 高速道路番号 — never an operator's own name or shield. The
 * exits' and entrances' own names are the real ones (G6 reads them from the road tiles).
 *
 * Sizes come from the figures in letter heights (110-B: 200 × 320 cm; 103・104: 120 × 120 cm at
 * 20 cm letters); the 都市高速's own letter height is G6's (the design keeps 30 cm as a guess).
 */

const ARROW_CELL = 1.9;

const arrow = (cx: number, cy: number, angle: number, length: number, h: number): BoxNode => {
  const { dx, dy } = armVector(angle);
  return {
    type: "arrow",
    colour: "white",
    tail: { x: cx - (dx * length) / 2, y: cy - (dy * length) / 2 },
    tip: { x: cx + (dx * length) / 2, y: cy + (dy * length) / 2 },
    shaft: 0.32 * h,
    headW: 0.9 * h,
    headL: 0.66 * h,
  };
};

function nameNodes(
  n: SignName,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: "white" | "green",
): BoxNode[] {
  const out: BoxNode[] = [
    {
      type: "text",
      text: spacedName(n),
      font: "jp",
      cm: h,
      x,
      y: y + 0.02 * h,
      align: "left",
      baseline: "top",
      colour,
      maxW: w,
    },
  ];
  if (n.en)
    out.push({
      type: "text",
      text: n.en,
      font: "latin",
      cm: romanHeight(h),
      x,
      y: y + 1.1 * h,
      align: "left",
      baseline: "top",
      colour,
      maxW: w,
    });
  return out;
}

/** 108の2-C〜E: the junction diagram on green, route symbols on the arms. */
export function layoutExpresswayDiagram(c: ExpresswayDiagramContent, measure: Measure) {
  return layoutJunction({ arms: c.arms, distance: c.distance, letter: c.letter, field: "green" }, measure);
}

/** 110-B・112-B・113-A・B. */
export function layoutExit(
  c: ExitContent,
  measure: Measure,
): { width: number; height: number; nodes: BoxNode[] } {
  const h = c.letter;
  const m = 0.42 * h;
  const cell = ARROW_CELL * h;
  const isExitOnly = c.exitName === null;
  const headW = isExitOnly
    ? Math.max(textWidth(measure, "jp", h, "出口"), textWidth(measure, "latin", romanHeight(h), "EXIT"))
    : nameWidth(measure, c.exitName as SignName, h);
  const distanceText = c.distance === null ? null : `${c.distance}m`;
  const lineW =
    textWidth(measure, "jp", 0.8 * h, "出口") +
    (distanceText ? 0.5 * h + textWidth(measure, "latin", 0.8 * h, distanceText) : 0);
  const plateW = c.number ? Math.max(1.6 * h, textWidth(measure, "latin", h, c.number) + 0.6 * h) : 0;
  const namesW = c.names.reduce((s, n) => s + nameWidth(measure, n, h) + 0.6 * h, 0);
  const topW = m + cell + 0.3 * h + Math.max(headW, isExitOnly ? 0 : lineW) + m;
  const bottomW = m + plateW + (plateW > 0 ? 0.5 * h : 0) + namesW + m;
  const width = Math.max((320 * h) / 30, topW, bottomW);
  const topH = NAME_H(h) + (isExitOnly ? 0 : 1.2 * h);
  const hasBottom = c.number !== null || c.names.length > 0;
  const bottomH = hasBottom ? NAME_H(h) + 0.3 * h : 0;
  const height = 2 * m + topH + (hasBottom ? 0.3 * h : 0) + bottomH;
  const nodes: BoxNode[] = [{ type: "background", field: "green", letter: h }];
  nodes.push(arrow(m + cell / 2, m + topH / 2, c.angle, Math.min(topH, cell) * 0.95, h));
  const x0 = m + cell + 0.3 * h;
  if (isExitOnly) {
    nodes.push(
      ...nameNodes({ ja: "出口", en: "EXIT", expressway: false }, x0, m, width - x0 - m, h, "white"),
    );
  } else {
    nodes.push(...nameNodes(c.exitName as SignName, x0, m, width - x0 - m, h, "white"));
    const lineY = m + NAME_H(h) + 0.15 * h;
    nodes.push({
      type: "text",
      text: "出口",
      font: "jp",
      cm: 0.8 * h,
      x: x0,
      y: lineY,
      align: "left",
      baseline: "top",
      colour: "white",
      maxW: null,
    });
    if (distanceText)
      nodes.push({
        type: "text",
        text: distanceText,
        font: "latin",
        cm: 0.8 * h,
        x: x0 + textWidth(measure, "jp", 0.8 * h, "出口") + 0.5 * h,
        y: lineY + 0.08 * h,
        align: "left",
        baseline: "top",
        colour: "white",
        maxW: null,
      });
  }
  if (!hasBottom) return { width, height, nodes };
  const by = m + topH + 0.3 * h;
  let x = m;
  if (c.number) {
    // 出口番号: white plate, green figures.
    nodes.push({
      type: "field",
      x,
      y: by,
      w: plateW,
      h: bottomH - 0.3 * h,
      radius: 0.1 * h,
      fill: "white",
      stroke: null,
    });
    nodes.push({
      type: "text",
      text: c.number,
      font: "latin",
      cm: h,
      x: x + plateW / 2,
      y: by + (bottomH - 0.3 * h) / 2,
      align: "center",
      baseline: "middle",
      colour: "green",
      maxW: plateW - 0.3 * h,
    });
    x += plateW + 0.5 * h;
  }
  for (const n of c.names) {
    const w = nameWidth(measure, n, h);
    nodes.push(...nameNodes(n, x, by, w, h, "white"));
    x += w + 0.6 * h;
  }
  return { width, height, nodes };
}

/** 103-A・B・104: the white band (operator, route symbol, entrance) over the green one. */
export function layoutEntrance(
  c: EntranceContent,
  measure: Measure,
): { width: number; height: number; nodes: BoxNode[] } {
  const h = c.letter;
  const m = 0.42 * h;
  const operator: SignName = { ja: ja[c.operator], en: en[c.operator], expressway: false };
  const symbol = c.route ? ROUTE_SYMBOL_RATIO.value.destination * h * 1.4 : 0;
  const topW = m + (symbol > 0 ? symbol + 0.4 * h : 0) + nameWidth(measure, operator, h) + m;
  const lower: SignName[] = [...(c.entranceName ? [c.entranceName] : []), ...c.names];
  const entranceText = c.distance === null ? "入口" : `入口 ${c.distance}m`;
  const lowerW =
    m +
    (c.angle !== null ? ARROW_CELL * h + 0.3 * h : 0) +
    Math.max(
      textWidth(measure, "jp", 0.85 * h, entranceText),
      ...lower.map((n) => nameWidth(measure, n, h)),
    ) +
    m;
  const width = Math.max((120 * h) / 20, topW, lowerW);
  const topH = NAME_H(h) + 0.4 * h;
  const lowerH = Math.max(1.4 * h, lower.length * NAME_H(h)) + 1.2 * h;
  const height = 2 * m + topH + lowerH;
  const nodes: BoxNode[] = [
    { type: "background", field: "green", letter: h },
    // The upper band, white with green letters (入口の方向・入口の予告 の図).
    {
      type: "field",
      x: m / 2,
      y: m / 2,
      w: width - m,
      h: topH + m / 2,
      radius: 0.2 * h,
      fill: "white",
      stroke: null,
    },
  ];
  let x = m;
  if (c.route) {
    nodes.push({ type: "shield", x: x + symbol / 2, y: m + topH / 2, size: symbol, shield: c.route });
    x += symbol + 0.4 * h;
  }
  nodes.push(...nameNodes(operator, x, m + 0.2 * h, width - x - m, h, "green"));
  const ly = m + topH + 0.3 * h;
  let lx = m;
  if (c.angle !== null) {
    nodes.push(arrow(m + (ARROW_CELL * h) / 2, ly + lowerH / 2 - 0.15 * h, c.angle, 1.5 * h, h));
    lx += ARROW_CELL * h + 0.3 * h;
  }
  lower.forEach((n, i) => {
    nodes.push(...nameNodes(n, lx, ly + i * NAME_H(h), width - lx - m, h, "white"));
  });
  nodes.push({
    type: "text",
    text: entranceText,
    font: "jp",
    cm: 0.85 * h,
    x: lx,
    y: ly + lower.length * NAME_H(h) + 0.1 * h,
    align: "left",
    baseline: "top",
    colour: "white",
    maxW: width - lx - m,
  });
  return { width, height, nodes };
}
