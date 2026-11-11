import jpFontUrl from "../../assets/signs/guide/guide-jp.woff2?url";
import latinFontUrl from "../../assets/signs/guide/guide-latin.woff2?url";
import { warn } from "../log";
import { GUIDE_COLOURS, IN_ARROW_RATIO } from "../signs/boardStandards";
import type {
  ArrowBox,
  BackgroundBox,
  BoardLayout,
  BoxNode,
  PictogramBox,
  Colour,
  FieldBox,
  JunctionArrowsBox,
  Measure,
  TextBox,
} from "../signs/board/boxes";
import type { BoardContent } from "../signs/board/content";
import { JP, LATIN, jpFont, latinFont } from "../signs/board/fonts";
import { layoutBoard } from "../signs/board/layout";
import { ROUTE_FRAME_ASPECT } from "../signs/board/routeSymbol";

/**
 * The layouter's last step: a board's boxes (src/signs/board/, in cm) drawn on a canvas. Only this
 * module touches the DOM: it loads the board fonts, measures text for the layout with the canvas's
 * own measureText, and draws each box in order.
 *
 * The drawing of the 108 boxes (rim, arrows, shields, 通称名 boxes, names, distance) is the code that
 * drew them before G5, line for line at the same canvas scale, so their pixels are unchanged
 * (scripts/qa/guideBoards.ts compares every board of five places).
 *
 * Fonts: Noto Sans JP and Overpass subset by scripts/textures/guide_fonts.py and shipped with
 * the game; the system's gothic stands in until they load (or if they fail to).
 */

const PAINT: Record<Colour, string> = {
  blue: GUIDE_COLOURS.value.blue,
  green: GUIDE_COLOURS.value.green,
  white: GUIDE_COLOURS.value.white,
};
const BLUE = PAINT.blue;
const WHITE = PAINT.white;
const GREEN = PAINT.green;

let fonts: Promise<void> | null = null;

/** Load the board fonts once (resolves even when they fail: the fallbacks draw instead). */
export function loadGuideFonts(): Promise<void> {
  if (fonts) return fonts;
  const faces = [
    new FontFace("GuideJP", `url(${jpFontUrl})`, { weight: "700" }),
    new FontFace("GuideLatin", `url(${latinFontUrl})`, { weight: "700" }),
  ];
  fonts = Promise.all(
    faces.map((f) =>
      f.load().then((loaded) => {
        document.fonts.add(loaded);
      }),
    ),
  )
    .then(() => undefined)
    .catch((error: unknown) => warn("guide_fonts_failed", { error: String(error) }));
  return fonts;
}

type Ctx = CanvasRenderingContext2D;

const measureCanvas = (() => {
  let c: Ctx | null = null;
  return () => {
    c ??= document.createElement("canvas").getContext("2d") as Ctx;
    return c;
  };
})();

/** The layout's text measure: the canvas's measureText in the board fonts. */
export const canvasMeasure: Measure = (font, text) => {
  const ctx = measureCanvas();
  ctx.font = font;
  return ctx.measureText(text).width;
};

/** A board's content laid out with the canvas's measure (the fonts should be loaded first). */
export const layoutGuideBoard = (content: BoardContent): BoardLayout => layoutBoard(content, canvasMeasure);

/** Text that fits `maxW` (canvas px), condensed horizontally down to 70 % before it overflows. */
function fitText(ctx: Ctx, text: string, x: number, y: number, maxW: number): void {
  const w = ctx.measureText(text).width;
  const sx = w > maxW ? Math.max(0.7, maxW / w) : 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 国道番号 (118-A): rounded inverted triangle, white rim, blue field, white number (備考一(三)1(4)). */
function drawNationalShield(ctx: Ctx, cx: number, cy: number, size: number, number: string): void {
  const s = size / 2;
  const shape = (k: number) => {
    const w = s * k;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.78, cy - w * 0.82);
    ctx.quadraticCurveTo(cx, cy - w * 0.98, cx + w * 0.78, cy - w * 0.82);
    ctx.quadraticCurveTo(cx + w * 1.06, cy - w * 0.66, cx + w * 0.86, cy - w * 0.22);
    ctx.quadraticCurveTo(cx + w * 0.42, cy + w * 0.72, cx, cy + w * 0.98);
    ctx.quadraticCurveTo(cx - w * 0.42, cy + w * 0.72, cx - w * 0.86, cy - w * 0.22);
    ctx.quadraticCurveTo(cx - w * 1.06, cy - w * 0.66, cx - w * 0.78, cy - w * 0.82);
    ctx.closePath();
  };
  ctx.fillStyle = WHITE;
  shape(1);
  ctx.fill();
  ctx.fillStyle = BLUE;
  shape(0.86);
  ctx.fill();
  ctx.fillStyle = WHITE;
  ctx.font = `700 ${Math.round(size * (number.length > 2 ? 0.42 : 0.5))}px ${LATIN}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fitText(ctx, number, cx, cy - s * 0.12, size * 0.72);
}

/** 都道府県道番号 (118の2-A): the hexagon, same colours (備考一(三)1(12)). */
function drawPrefecturalShield(ctx: Ctx, cx: number, cy: number, size: number, number: string): void {
  const s = size / 2;
  const shape = (k: number) => {
    const w = s * k;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.53, cy - w * 0.9);
    ctx.lineTo(cx + w * 0.53, cy - w * 0.9);
    ctx.lineTo(cx + w, cy - w * 0.1);
    ctx.lineTo(cx + w * 0.68, cy + w * 0.9);
    ctx.lineTo(cx - w * 0.68, cy + w * 0.9);
    ctx.lineTo(cx - w, cy - w * 0.1);
    ctx.closePath();
  };
  ctx.fillStyle = WHITE;
  shape(1);
  ctx.fill();
  ctx.fillStyle = BLUE;
  shape(0.86);
  ctx.fill();
  ctx.fillStyle = WHITE;
  ctx.font = `700 ${Math.round(size * (number.length > 2 ? 0.42 : 0.5))}px ${LATIN}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fitText(ctx, number, cx, cy + s * 0.02, size * 0.8);
}

/**
 * An expressway's route symbol in the form of 118の3 高速道路番号: a rounded rectangle, white rim,
 * green field, white figures. Why not the operator's own shield (a circle, a hexagon): those are the
 * operator's marks, which the game does not draw (AGENTS.md).
 */
function drawRouteSymbol(ctx: Ctx, cx: number, cy: number, size: number, number: string): void {
  const w = size * Math.max(1, 0.45 + 0.32 * number.length);
  const h = size * ROUTE_FRAME_ASPECT;
  ctx.fillStyle = WHITE;
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h * 0.22);
  ctx.fill();
  const rim = Math.max(1, size * 0.07);
  ctx.fillStyle = GREEN;
  roundRect(ctx, cx - w / 2 + rim, cy - h / 2 + rim, w - 2 * rim, h - 2 * rim, h * 0.18);
  ctx.fill();
  ctx.fillStyle = WHITE;
  ctx.font = `700 ${Math.round(h * 0.62)}px ${LATIN}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fitText(ctx, number, cx, cy + h * 0.02, w - 3 * rim);
}

/** 通称名 box on an arm: white, pointed ends, blue letters 0.6 of the letter height. */
function drawStreetBox(ctx: Ctx, name: string, cx: number, cy: number, letterPx: number, maxW: number): void {
  ctx.font = `700 ${Math.round(letterPx * IN_ARROW_RATIO.value)}px ${JP}`;
  const textW = Math.min(ctx.measureText(name).width, maxW - letterPx * 0.9);
  const w = textW + letterPx * 0.9;
  const h = letterPx * 0.9;
  const point = h * 0.35;
  const path = (inset: number) => {
    const x0 = cx - w / 2 + inset;
    const x1 = cx + w / 2 - inset;
    const y0 = cy - h / 2 + inset;
    const y1 = cy + h / 2 - inset;
    ctx.beginPath();
    ctx.moveTo(x0 + point, y0);
    ctx.lineTo(x1 - point, y0);
    ctx.lineTo(x1, cy);
    ctx.lineTo(x1 - point, y1);
    ctx.lineTo(x0 + point, y1);
    ctx.lineTo(x0, cy);
    ctx.closePath();
  };
  ctx.fillStyle = WHITE;
  path(0);
  ctx.fill();
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = Math.max(1, letterPx * 0.05);
  path(letterPx * 0.07);
  ctx.stroke();
  ctx.fillStyle = BLUE;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fitText(ctx, name, cx, cy + letterPx * 0.02, textW);
}

/** White rim (縁, at least 1/20 of the letter height) round the field. */
function drawBackground(ctx: Ctx, b: BackgroundBox, W: number, H: number, k: number): void {
  const h = b.letter;
  ctx.fillStyle = WHITE;
  roundRect(ctx, 0, 0, W, H, 0.35 * h * k);
  ctx.fill();
  const rim = Math.max(2, (h / 14) * k);
  ctx.fillStyle = PAINT[b.field];
  roundRect(ctx, rim, rim, W - 2 * rim, H - 2 * rim, 0.3 * h * k);
  ctx.fill();
}

function drawJunctionArrows(ctx: Ctx, a: JunctionArrowsBox, k: number): void {
  const h = a.letter;
  const { x: jx, y: jy } = a.junction;
  const shaft = 0.3 * h * k;
  const headW = 0.82 * h * k;
  const headL = 0.62 * h * k;
  ctx.strokeStyle = PAINT[a.colour];
  ctx.fillStyle = PAINT[a.colour];
  ctx.lineWidth = shaft;
  ctx.lineCap = "butt";
  // Stem from the bottom to the junction (a little past it, so the arms join cleanly).
  ctx.beginPath();
  ctx.moveTo(jx * k, a.stemBottom * k);
  ctx.lineTo(jx * k, jy * k - shaft / 2);
  ctx.stroke();
  for (const t of a.tips) {
    const ex = t.x * k - t.dx * headL;
    const ey = t.y * k - t.dy * headL;
    ctx.beginPath();
    ctx.moveTo(jx * k - t.dx * shaft * 0.5, jy * k - t.dy * shaft * 0.5);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // Arrow head.
    const nx = -t.dy;
    const ny = t.dx;
    ctx.beginPath();
    ctx.moveTo(t.x * k, t.y * k);
    ctx.lineTo(ex + (nx * headW) / 2, ey + (ny * headW) / 2);
    ctx.lineTo(ex - (nx * headW) / 2, ey - (ny * headW) / 2);
    ctx.closePath();
    ctx.fill();
  }
}

function drawArrow(ctx: Ctx, a: ArrowBox, k: number): void {
  const len = Math.hypot(a.tip.x - a.tail.x, a.tip.y - a.tail.y);
  if (len <= 0) return;
  const dx = (a.tip.x - a.tail.x) / len;
  const dy = (a.tip.y - a.tail.y) / len;
  const ex = (a.tip.x - dx * a.headL) * k;
  const ey = (a.tip.y - dy * a.headL) * k;
  ctx.strokeStyle = PAINT[a.colour];
  ctx.fillStyle = PAINT[a.colour];
  ctx.lineWidth = a.shaft * k;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(a.tail.x * k, a.tail.y * k);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  const nx = -dy;
  const ny = dx;
  const half = (a.headW * k) / 2;
  ctx.beginPath();
  ctx.moveTo(a.tip.x * k, a.tip.y * k);
  ctx.lineTo(ex + nx * half, ey + ny * half);
  ctx.lineTo(ex - nx * half, ey - ny * half);
  ctx.closePath();
  ctx.fill();
}

function drawField(ctx: Ctx, f: FieldBox, k: number): void {
  ctx.fillStyle = PAINT[f.fill];
  roundRect(ctx, f.x * k, f.y * k, f.w * k, f.h * k, f.radius * k);
  ctx.fill();
  if (!f.stroke) return;
  ctx.strokeStyle = PAINT[f.stroke.colour];
  ctx.lineWidth = Math.max(1, f.stroke.width * k);
  ctx.stroke();
}

function drawText(ctx: Ctx, t: TextBox, k: number): void {
  ctx.fillStyle = PAINT[t.colour];
  ctx.textAlign = t.align;
  ctx.textBaseline = t.baseline;
  ctx.font = t.font === "jp" ? jpFont(t.cm, k) : latinFont(t.cm, k);
  if (t.maxW === null) ctx.fillText(t.text, t.x * k, t.y * k);
  else fitText(ctx, t.text, t.x * k, t.y * k, t.maxW * k);
}

/**
 * The fixed figures of 116の4 (図 046: a black receiver on a white square) and 116の6 (図 048: the
 * carriageway in white, a dashed lane line, and the bay cut into its left edge), drawn as paths in
 * the box's proportions read off the figures.
 */
function drawPictogram(ctx: Ctx, p: PictogramBox, k: number): void {
  const x = p.x * k;
  const y = p.y * k;
  const w = p.w * k;
  const h = p.h * k;
  if (p.figure === "phone") {
    const side = Math.min(w, h);
    const sx = x + (w - side) / 2;
    const sy = y + (h - side) / 2;
    ctx.fillStyle = WHITE;
    ctx.fillRect(sx, sy, side, side);
    // The receiver: a thick arc from the ear piece (top left) to the mouth piece (bottom right).
    ctx.strokeStyle = "#111111";
    ctx.lineCap = "round";
    ctx.lineWidth = side * 0.17;
    ctx.beginPath();
    ctx.arc(sx + side * 0.62, sy + side * 0.38, side * 0.32, Math.PI * 0.62, Math.PI * 1.32);
    ctx.stroke();
    ctx.fillStyle = "#111111";
    const pad = (cx: number, cy: number, a: number) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      roundRect(ctx, -side * 0.16, -side * 0.1, side * 0.32, side * 0.2, side * 0.06);
      ctx.fill();
      ctx.restore();
    };
    pad(sx + side * 0.36, sy + side * 0.18, -0.55);
    pad(sx + side * 0.6, sy + side * 0.74, 0.35);
    return;
  }
  // 116の6: two white edge strips, a dashed centre line, the bay on the left a third of the way.
  ctx.fillStyle = WHITE;
  const road = w * 0.62;
  const left = x + (w - road) / 2 + w * 0.05;
  const strip = w * 0.06;
  ctx.fillRect(left, y, strip, h);
  ctx.fillRect(left + road - strip, y, strip, h);
  const dash = h / 7;
  for (let d = 0; d < 7; d += 2) ctx.fillRect(left + road / 2 - strip / 2, y + d * dash, strip, dash);
  ctx.beginPath();
  ctx.moveTo(left, y + h * 0.3);
  ctx.lineTo(left - w * 0.16, y + h * 0.38);
  ctx.lineTo(left - w * 0.16, y + h * 0.62);
  ctx.lineTo(left, y + h * 0.7);
  ctx.closePath();
  ctx.fill();
}

function drawNode(ctx: Ctx, node: BoxNode, W: number, H: number, k: number): void {
  switch (node.type) {
    case "background":
      return drawBackground(ctx, node, W, H, k);
    case "junction-arrows":
      return drawJunctionArrows(ctx, node, k);
    case "arrow":
      return drawArrow(ctx, node, k);
    case "field":
      return drawField(ctx, node, k);
    case "text":
      return drawText(ctx, node, k);
    case "street":
      return drawStreetBox(ctx, node.text, node.x * k, node.y * k, node.letter * k, node.w * k);
    case "rule":
      ctx.strokeStyle = PAINT[node.colour];
      ctx.lineWidth = Math.max(1, node.width * k);
      ctx.beginPath();
      ctx.moveTo(node.from.x * k, node.from.y * k);
      ctx.lineTo(node.to.x * k, node.to.y * k);
      ctx.stroke();
      return;
    case "pictogram":
      return drawPictogram(ctx, node, k);
    case "shield": {
      const { shield } = node;
      if (shield.kind === "national")
        return drawNationalShield(ctx, node.x * k, node.y * k, node.size * k, shield.number);
      if (shield.kind === "prefectural")
        return drawPrefecturalShield(ctx, node.x * k, node.y * k, node.size * k, shield.number);
      return drawRouteSymbol(ctx, node.x * k, node.y * k, node.size * k, shield.number);
    }
  }
}

/**
 * The one canvas every board is drawn on, with a CPU-backed context (willReadFrequently): the
 * commands rasterise as they are drawn, and createImageBitmap copies memory instead of reading the
 * GPU canvas back (knowledge/sign-system.md「BoardFacePool」 has the measurement).
 * Why not a fresh canvas per board (G5): a canvas and its context per board, and a GPU read back in
 * every createImageBitmap.
 */
let boardCanvas: HTMLCanvasElement | null = null;

/**
 * Draw a laid-out board on a canvas `px` wide (the height follows the board's proportions). The
 * canvas is shared: the next call redraws it, so take its pixels (createImageBitmap, getImageData,
 * toDataURL) before drawing another board.
 */
export function drawBoard(layout: BoardLayout, px: number): HTMLCanvasElement {
  const k = px / layout.width;
  boardCanvas ??= document.createElement("canvas");
  const canvas = boardCanvas;
  // Setting the size clears the pixels and resets the context's state, even when it is the same.
  canvas.width = px;
  canvas.height = Math.round(layout.height * k);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as Ctx;
  const W = layout.width * k;
  const H = layout.height * k;
  for (const node of layout.nodes) drawNode(ctx, node, W, H, k);
  return canvas;
}
