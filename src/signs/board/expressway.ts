import { en } from "../../i18n/en";
import { ja } from "../../i18n/ja";
import type { BoxNode, Measure } from "./boxes";
import type {
  EntranceContent,
  ExitContent,
  ExpresswayDiagramContent,
  LaneContent,
  PictogramContent,
  SignName,
} from "./content";
import { NAME_H, nameWidth, spacedName, textWidth } from "./fonts";
import { armVector, layoutJunction } from "./junction";
import { romanHeight } from "./letters";
import { ENTRANCE_ROUTE_SYMBOL } from "../expresswaySignAssumptions";
import { ROUTE_FRAME_ASPECT } from "./routeSymbol";

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
  // The band's route symbol: its frame ENTRANCE_ROUTE_SYMBOL of the 日本字 high (an assumption:
  // the cap of 備考一(五)6 is written for 108の2, G5 review W6).
  const symbol = c.route ? (ENTRANCE_ROUTE_SYMBOL.value * h) / ROUTE_FRAME_ASPECT : 0;
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

/**
 * 111-B (図 029, 180 × 320 cm): the places centred, then along the bottom the exit number's plate,
 * the arrow down onto the lane and 「出口 400m」 with EXIT under it.
 */
export function layoutLane(
  c: LaneContent,
  measure: Measure,
): { width: number; height: number; nodes: BoxNode[] } {
  const h = c.letter;
  const m = 0.42 * h;
  const plateW = c.number ? Math.max(1.6 * h, textWidth(measure, "latin", h, c.number) + 0.6 * h) : 0;
  const distanceText = `${c.distance}m`;
  const exitW =
    textWidth(measure, "jp", 0.8 * h, "出口") + 0.4 * h + textWidth(measure, "latin", 0.8 * h, distanceText);
  const namesW = Math.max(...c.names.map((n) => nameWidth(measure, n, h)));
  const arrowCell = 1.4 * h;
  const bottomW = plateW + (plateW > 0 ? 0.8 * h : 0) + arrowCell + 0.8 * h + exitW;
  // 図 029 is 320 cm wide at its letters (read as 30 cm); never narrower than what it carries.
  const width = Math.max((320 * h) / 30, 2 * m + namesW, 2 * m + bottomW);
  const namesH = c.names.length * NAME_H(h);
  const bottomH = 1.4 * h;
  const height = 2 * m + namesH + 0.2 * h + bottomH;
  const nodes: BoxNode[] = [{ type: "background", field: "green", letter: h }];
  c.names.forEach((n, i) => {
    const w = nameWidth(measure, n, h);
    nodes.push(...nameNodes(n, (width - w) / 2, m + i * NAME_H(h), w, h, "white"));
  });
  const cy = m + namesH + 0.2 * h + bottomH / 2;
  let x = (width - bottomW) / 2;
  if (c.number) {
    nodes.push({
      type: "field",
      x,
      y: cy - 0.6 * h,
      w: plateW,
      h: 1.2 * h,
      radius: 0.1 * h,
      fill: "white",
      stroke: null,
    });
    nodes.push({
      type: "text",
      text: c.number,
      font: "latin",
      cm: 0.8 * h,
      x: x + plateW / 2,
      y: cy,
      align: "center",
      baseline: "middle",
      colour: "green",
      maxW: plateW - 0.3 * h,
    });
    x += plateW + 0.8 * h;
  }
  // The arrow down onto the lane (180°: straight down).
  nodes.push(arrow(x + arrowCell / 2, cy, 180, 1.35 * h, h));
  x += arrowCell + 0.8 * h;
  const line = (text: string, font: "jp" | "latin", cm: number, tx: number, ty: number): BoxNode => ({
    type: "text",
    text,
    font,
    cm,
    x: tx,
    y: ty,
    align: "left",
    baseline: "top",
    colour: "white",
    maxW: null,
  });
  nodes.push(line("出口", "jp", 0.8 * h, x, cy - 0.55 * h));
  nodes.push(
    line(
      distanceText,
      "latin",
      0.8 * h,
      x + textWidth(measure, "jp", 0.8 * h, "出口") + 0.4 * h,
      cy - 0.47 * h,
    ),
  );
  nodes.push(line("EXIT", "latin", 0.3 * h, x, cy + 0.38 * h));
  return { width, height, nodes };
}

/**
 * 113-A・B 出口 at the nose (図 033, 295 × 150 cm at 50 cm letters: upright): 「出口 EXIT」 on top,
 * the arrow off the main line, and (113-B) the exit number's plate with the place under it at 0.6
 * of the letters. G5 laid 113 out as the wide exit board; the figure is upright (G6 review W2).
 */
export function layoutNose(
  c: ExitContent,
  measure: Measure,
): { width: number; height: number; nodes: BoxNode[] } {
  const h = c.letter;
  const m = 0.42 * h;
  const small = 0.6 * h;
  const plateW = c.number ? Math.max(h, textWidth(measure, "latin", 0.76 * h, c.number) + 0.3 * h) : 0;
  const placeW = c.names.reduce((w, n) => Math.max(w, nameWidth(measure, n, small)), 0);
  const bottomW = plateW + (plateW > 0 && placeW > 0 ? 0.3 * h : 0) + placeW;
  const width = Math.max(3 * h, textWidth(measure, "jp", h, "出口") + 2 * m, bottomW + 2 * m);
  const arrowH = 2.2 * h;
  const hasBottom = c.number !== null || c.names.length > 0;
  const bottomH = hasBottom ? 1.3 * h : 0;
  const height = Math.max(5.9 * h, m + 1.9 * h + arrowH + bottomH + 2 * m);
  const nodes: BoxNode[] = [{ type: "background", field: "green", letter: h }];
  const text = (
    t: string,
    font: "jp" | "latin",
    cm: number,
    x: number,
    y: number,
    colour: "white" | "green" = "white",
  ): BoxNode => ({
    type: "text",
    text: t,
    font,
    cm,
    x,
    y,
    align: "center",
    baseline: "top",
    colour,
    maxW: width - 2 * m,
  });
  nodes.push(text("出口", "jp", h, width / 2, m));
  nodes.push(text("EXIT", "latin", 0.5 * h, width / 2, m + 1.15 * h));
  const arrowY = m + 1.9 * h + arrowH / 2;
  nodes.push(arrow(width / 2, arrowY, c.angle, arrowH * 0.95, 1.2 * h));
  if (!hasBottom) return { width, height, nodes };
  const by = height - m - bottomH;
  let x = (width - bottomW) / 2;
  if (c.number) {
    // White ground, green figures (備考一(三)1(13)).
    nodes.push({
      type: "field",
      x,
      y: by,
      w: plateW,
      h: bottomH,
      radius: 0.08 * h,
      fill: "white",
      stroke: null,
    });
    nodes.push({
      type: "text",
      text: c.number,
      font: "latin",
      cm: 0.76 * h,
      x: x + plateW / 2,
      y: by + bottomH / 2,
      align: "center",
      baseline: "middle",
      colour: "green",
      maxW: plateW - 0.2 * h,
    });
    x += plateW + 0.3 * h;
  }
  for (const n of c.names) nodes.push(...nameNodes(n, x, by + 0.05 * h, placeW, small, "white"));
  return { width, height, nodes };
}

/** The figures at 図示: size (cm, wide × high), the caption's height and text, the figure drawn. */
export const PICTOGRAMS = {
  "116の4": { w: 60, h: 90, caption: 14, text: "非常電話", figure: "phone" },
  "116の6": { w: 60, h: 90, caption: 10, text: "非常駐車帯", figure: "bay" },
} as const;

/**
 * 116の4・116の6 (図 046・048): green, the figure above and its caption under it, everything scaled
 * from 図示 by the caption height (`letter`). Why not the Pillow painter the design planned
 * (`art.by = "painter"`): the other green boards, their face pool and their night return are on
 * the canvas path, and a Pillow texture on the deck would need a second pool for two fixed figures.
 */
export function layoutPictogram(c: PictogramContent): { width: number; height: number; nodes: BoxNode[] } {
  const f = PICTOGRAMS[c.kind];
  const k = c.letter / f.caption;
  const width = f.w * k;
  const height = f.h * k;
  const m = 6 * k;
  const captionH = 1.6 * c.letter;
  return {
    width,
    height,
    nodes: [
      { type: "background", field: "green", letter: c.letter },
      { type: "pictogram", figure: f.figure, x: m, y: m, w: width - 2 * m, h: height - 2 * m - captionH },
      {
        type: "text",
        text: f.text,
        font: "jp",
        cm: c.letter,
        x: width / 2,
        y: height - m - captionH / 2,
        align: "center",
        baseline: "middle",
        colour: "white",
        maxW: width - 2 * m,
      },
    ],
  };
}
