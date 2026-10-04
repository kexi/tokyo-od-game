import jpFontUrl from "../../assets/signs/guide/guide-jp.woff2?url";
import latinFontUrl from "../../assets/signs/guide/guide-latin.woff2?url";
import { warn } from "../log";
import type { ArmSpec, BoardSpec, Shield, SignName } from "./guidePlan";

/**
 * Board faces of the 108 series drawn on a canvas (別表第二 図 016–024, 229, 230):
 * white letters, arrows and rim on blue (備考一(三)1(13)), the junction's arms as arrows from a stem
 * rising from the bottom, the place names at the arrow heads with their English underneath at half
 * the height (備考一(五)2), 国道番号 shields (118-A, the inverted "onigiri") and 都道府県道番号
 * hexagons (118の2-A) on the arms, 通称名 in white boxes with blue letters (108の3・4, 備考一(三)1(14),
 * 0.6 of the letter height, 備考一(五)3), 高速道路 names on green (備考一(三)1(13) ただし書) and, on the
 * 予告, the distance under the stem (図 016).
 *
 * Fonts: Noto Sans JP and Overpass subset by scripts/textures/guide_fonts.py and shipped with
 * the game; the system's gothic stands in until they load (or if they fail to).
 */

const BLUE = "#1d4f9c"; // the junction-name plates' blue (trafficControl.ts): one 案内標識 blue
const WHITE = "#ffffff";
const GREEN = "#0a7d4f";
const JP = `GuideJP, "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif`;
const LATIN = `GuideLatin, "Helvetica Neue", Arial, sans-serif`;
// Overpass's capital height is 0.70 em: the font size that makes capitals half the 漢字.
const LATIN_CAP = 0.7;

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
type Box = { x: number; y: number; w: number; h: number };
type NameBox = { names: SignName[]; box: Box; stack: boolean };
/** A shield or a 通称名 box on an arm, centred at (x, y), all in cm. */
type Mark = {
  arm: ArmSpec;
  kind: "shield" | "street";
  x: number;
  y: number;
  w: number;
  h: number;
  shield?: Shield;
};

/** Board size and where everything goes, in centimetres from the top-left corner. */
export type BoardLayout = {
  spec: BoardSpec;
  width: number;
  height: number;
  junction: { x: number; y: number };
  stemBottom: number;
  tips: Array<{ arm: ArmSpec; x: number; y: number; dx: number; dy: number }>;
  marks: Mark[];
  labels: NameBox[];
};

const measureCanvas = (() => {
  let c: Ctx | null = null;
  return () => {
    c ??= document.createElement("canvas").getContext("2d") as Ctx;
    return c;
  };
})();

const jpFont = (cm: number, k: number) => `700 ${Math.round(cm * k)}px ${JP}`;
const latinFont = (cm: number, k: number) => `700 ${Math.round((cm / LATIN_CAP) * k)}px ${LATIN}`;

/** Width (cm) of a name block: the wider of its Japanese and its English (half height). */
function nameWidth(ctx: Ctx, n: SignName, h: number): number {
  const k = 4; // measure at 4 px/cm
  ctx.font = jpFont(h, k);
  const jp = ctx.measureText(spacedName(n)).width / k;
  ctx.font = latinFont(h / 2, k);
  const en = n.en ? ctx.measureText(n.en).width / k : 0;
  return Math.max(jp, en) + (n.expressway ? 0.5 * h : 0);
}

// Two-character names are spaced out as on the real boards (「上 馬」「大 森」, 図 016).
const spacedName = (n: SignName) => (n.ja.length === 2 && !n.expressway ? `${n.ja[0]} ${n.ja[1]}` : n.ja);

const NAME_H = (h: number) => 1.75 * h; // 漢字, a gap, the English line
const SHIELD = (h: number) => 1.15 * h; // 国道番号・都道府県道番号 on the arms
const HEAD_L = (h: number) => 0.62 * h;

/** Direction of an arm on the board for its angle (+ left): up is straight on. */
const armVector = (angle: number) => ({
  dx: -Math.sin((angle * Math.PI) / 180),
  dy: -Math.cos((angle * Math.PI) / 180),
});

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Lay a board out: the standard 280 × 220 cm (交差点) or 280 × 240 cm (予告) at 30 cm letters
 * (国土交通省 Q&A), scaled with the letter height and widened when the names need it (備考一(二)).
 * Arrows first, then the shields and 通称名 boxes half way along them, then each arm's names at the
 * first of a few spots (over the arm, beside its head, under it) that clears what is drawn already.
 */
export function layoutBoard(spec: BoardSpec): BoardLayout {
  const ctx = measureCanvas();
  const h = spec.letter;
  const m = 0.42 * h; // margin inside the rim
  const isAdvance = spec.distance !== null;
  const height = ((isAdvance ? 240 : 220) * h) / 30;
  const named = spec.arms.filter((a) => a.names.length > 0);
  const blockWidth = (a: ArmSpec, stack: boolean) => {
    const ws = a.names.map((n) => nameWidth(ctx, n, h));
    return stack ? Math.max(...ws) : ws.reduce((sum, w) => sum + w, 0) + (ws.length - 1) * 0.9 * h;
  };
  const straight = named.find((a) => a.angle === 0);
  const sideNeed = Math.max(
    0,
    ...named.filter((a) => a.angle !== 0).map((a) => blockWidth(a, true) + 0.6 * h),
  );
  const topNeed = straight ? blockWidth(straight, false) : 0;
  let width = Math.max((280 * h) / 30, 2 * (sideNeed + m), topNeed + 2 * m + 0.4 * h);
  width = Math.min(width, (420 * h) / 30); // a board stays a board: longer names condense
  const jx = width / 2;
  const top = m;
  const stacks = Math.max(1, ...named.filter((a) => a.angle !== 0).map((a) => a.names.length));
  const tipY = top + NAME_H(h) + 0.25 * h;
  const stemBottom = height - m - (isAdvance ? 1.15 * h : 0);
  const jy = Math.max(tipY + 2.4 * h, Math.min(stemBottom - 1.6 * h, top + stacks * NAME_H(h) + 1.1 * h));

  const tips: BoardLayout["tips"] = spec.arms.map((arm) => {
    const { dx, dy } = armVector(arm.angle);
    const a = Math.abs(arm.angle);
    const len =
      a === 0
        ? jy - tipY
        : a === 90
          ? jx - m - 0.15 * h
          : a === 45
            ? 0.78 * Math.min((jx - m - 0.3 * h) / Math.SQRT1_2, (jy - tipY) / Math.SQRT1_2)
            : 0.8 * Math.min((jx - m) / Math.SQRT1_2, (stemBottom - jy) / Math.SQRT1_2);
    return { arm, x: jx + dx * len, y: jy + dy * len, dx, dy };
  });

  // Obstacles: the stem and every arm (as a chain of small boxes), then the marks.
  const taken: Box[] = [];
  const pad = 0.12 * h;
  const shaftBox = (x0: number, y0: number, x1: number, y1: number) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (0.5 * h)));
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      taken.push({ x: x - 0.4 * h, y: y - 0.4 * h, w: 0.8 * h, h: 0.8 * h });
    }
  };
  shaftBox(jx, jy, jx, stemBottom);
  for (const t of tips) shaftBox(jx, jy, t.x, t.y);

  const marks: Mark[] = [];
  for (const t of tips) {
    const len = Math.hypot(t.x - jx, t.y - jy);
    // Street boxes half way out; shields nearer the junction, leaving the outer part to the names.
    const along = len * (t.arm.street ? 0.5 : 0.42);
    const mx = jx + t.dx * along;
    const my = jy + t.dy * along;
    if (t.arm.street) {
      ctx.font = jpFont(0.6 * h, 4);
      const room = Math.max(2 * h, len - HEAD_L(h) - 0.5 * h);
      const w = Math.min(ctx.measureText(t.arm.street).width / 4 + 0.9 * h, room);
      marks.push({ arm: t.arm, kind: "street", x: mx, y: my, w, h: 0.9 * h });
    } else {
      const n = t.arm.shields.length;
      // Side by side along a side arm; across the shaft on the straight one (図 229).
      const isStraight = t.arm.angle === 0;
      const [ux, uy] = isStraight ? [1, 0] : [t.dx, t.dy];
      t.arm.shields.forEach((shield, i) => {
        const off = (i - (n - 1) / 2) * SHIELD(h) * 1.05;
        marks.push({
          arm: t.arm,
          kind: "shield",
          x: mx + ux * off,
          y: my + uy * off,
          w: SHIELD(h),
          h: SHIELD(h),
          shield,
        });
      });
    }
  }
  for (const mk of marks) taken.push({ x: mk.x - mk.w / 2, y: mk.y - mk.h / 2, w: mk.w, h: mk.h });

  const labels: NameBox[] = [];
  const clampBox = (b: Box): Box => ({
    ...b,
    x: Math.max(m, Math.min(width - m - b.w, b.x)),
    y: Math.max(m, Math.min(height - m - b.h, b.y)),
  });
  const order = tips.toSorted((a, b) => Math.abs(a.arm.angle) - Math.abs(b.arm.angle));
  for (const t of order) {
    const arm = t.arm;
    if (arm.names.length === 0) continue;
    const stack = arm.angle !== 0;
    const a = Math.abs(arm.angle);
    const side = arm.angle > 0 ? -1 : 1; // −1: the left half
    // Side names keep off the stem; straight-on names may span the board.
    const maxW = a === 0 ? width - 2 * m : jx - m - 0.55 * h;
    const w = Math.min(blockWidth(arm, stack), maxW);
    const bh = (stack ? arm.names.length : 1) * NAME_H(h);
    const outerCx = side < 0 ? m + (jx - m - 0.4 * h) / 2 : width - m - (jx - m - 0.4 * h) / 2;
    // Over a side arm, clear of the shields riding on it.
    const hasMarks = marks.some((mk) => mk.arm === arm);
    const above = jy - (hasMarks ? SHIELD(h) / 2 + 0.2 * h : 0.55 * h) - bh;
    const candidates: Box[] =
      a === 0
        ? [{ x: jx - w / 2, y: top, w, h: bh }]
        : a === 90
          ? [
              { x: outerCx - w / 2, y: above, w, h: bh },
              { x: side < 0 ? jx - 0.55 * h - w : jx + 0.55 * h, y: above, w, h: bh },
              { x: outerCx - w / 2, y: jy + (hasMarks ? SHIELD(h) / 2 + 0.15 * h : 0.5 * h), w, h: bh },
            ]
          : a === 45
            ? [
                { x: t.x - w / 2, y: t.y - 0.35 * h - bh, w, h: bh },
                { x: side < 0 ? t.x - 0.4 * h - w : t.x + 0.4 * h, y: t.y - bh / 2, w, h: bh },
                { x: side < 0 ? t.x - 0.4 * h - w : t.x + 0.4 * h, y: t.y + 0.3 * h, w, h: bh },
              ]
            : [
                { x: t.x - w / 2, y: t.y + 0.35 * h, w, h: bh },
                { x: side < 0 ? t.x - 0.4 * h - w : t.x + 0.4 * h, y: t.y - bh / 2, w, h: bh },
              ];
    // The first spot that is (nearly) clear, in the order real boards use; else the least covered.
    let best: { box: Box; cost: number } | null = null;
    for (const c of candidates.map(clampBox)) {
      const padded = { x: c.x - pad, y: c.y - pad, w: c.w + 2 * pad, h: c.h + 2 * pad };
      const cost = taken.reduce((sum, o) => sum + overlap(padded, o), 0);
      const isClear = cost < 0.06 * c.w * c.h;
      if (isClear) {
        best = { box: c, cost };
        break;
      }
      if (!best || cost < best.cost - 1e-6) best = { box: c, cost };
    }
    if (!best) continue;
    taken.push(best.box);
    labels.push({ names: arm.names, box: best.box, stack });
  }
  return { spec, width, height, junction: { x: jx, y: jy }, stemBottom, tips, marks, labels };
}

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

/** 通称名 box on an arm: white, pointed ends, blue letters 0.6 of the letter height. */
function drawStreetBox(ctx: Ctx, name: string, cx: number, cy: number, letterPx: number, maxW: number): void {
  ctx.font = `700 ${Math.round(letterPx * 0.6)}px ${JP}`;
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

function drawNames(ctx: Ctx, label: NameBox, h: number, k: number): void {
  const { box, names, stack } = label;
  const natural = names.map((n) => nameWidth(ctx, n, h));
  // Side by side, the names share the box (condensed alike when they do not fit).
  const gap = 0.9 * h;
  const total = natural.reduce((sum, w) => sum + w, 0) + (names.length - 1) * gap;
  const squeeze = stack
    ? 1
    : Math.min(1, (box.w - (names.length - 1) * gap) / Math.max(1e-6, total - (names.length - 1) * gap));
  const widths = natural.map((w) => (stack ? Math.min(w, box.w) : w * squeeze));
  const used = widths.reduce((sum, w) => sum + w, 0) + (names.length - 1) * gap;
  let x = box.x + (stack ? 0 : (box.w - used) / 2);
  names.forEach((n, i) => {
    const w = widths[i];
    const bx = stack ? box.x + (box.w - w) / 2 : x;
    const by = stack ? box.y + i * NAME_H(h) : box.y;
    const cx = (bx + w / 2) * k;
    const inner = (w - (n.expressway ? 0.5 * h : 0)) * k;
    if (n.expressway) {
      // 高速道路等の名称: white 区分線 round a green field.
      ctx.fillStyle = GREEN;
      roundRect(ctx, bx * k, (by - 0.08 * h) * k, w * k, NAME_H(h) * 0.98 * k, 0.12 * h * k);
      ctx.fill();
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = Math.max(1, (h / 20) * k);
      ctx.stroke();
    }
    ctx.fillStyle = WHITE;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = jpFont(h, k);
    fitText(ctx, spacedName(n), cx, (by + 0.02 * h) * k, inner);
    if (n.en) {
      ctx.font = latinFont(h / 2, k);
      fitText(ctx, n.en, cx, (by + 1.1 * h) * k, inner);
    }
    if (!stack) x += w + gap;
  });
}

/** Draw the board on a canvas `px` wide (the height follows the board's proportions). */
export function drawBoard(layout: BoardLayout, px: number): HTMLCanvasElement {
  const k = px / layout.width;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = Math.round(layout.height * k);
  const ctx = canvas.getContext("2d") as Ctx;
  const h = layout.spec.letter;
  const W = layout.width * k;
  const H = layout.height * k;
  // White rim (縁, at least 1/20 of the letter height) round the blue field.
  ctx.fillStyle = WHITE;
  roundRect(ctx, 0, 0, W, H, 0.35 * h * k);
  ctx.fill();
  const rim = Math.max(2, (h / 14) * k);
  ctx.fillStyle = BLUE;
  roundRect(ctx, rim, rim, W - 2 * rim, H - 2 * rim, 0.3 * h * k);
  ctx.fill();

  const { x: jx, y: jy } = layout.junction;
  const shaft = 0.3 * h * k;
  const headW = 0.82 * h * k;
  const headL = HEAD_L(h) * k;
  ctx.strokeStyle = WHITE;
  ctx.fillStyle = WHITE;
  ctx.lineWidth = shaft;
  ctx.lineCap = "butt";
  // Stem from the bottom to the junction (a little past it, so the arms join cleanly).
  ctx.beginPath();
  ctx.moveTo(jx * k, layout.stemBottom * k);
  ctx.lineTo(jx * k, jy * k - shaft / 2);
  ctx.stroke();
  for (const t of layout.tips) {
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
  // Shields and 通称名 boxes on the arms, half way out.
  for (const mk of layout.marks) {
    if (mk.kind === "street" && mk.arm.street)
      drawStreetBox(ctx, mk.arm.street, mk.x * k, mk.y * k, h * k, mk.w * k);
    else if (mk.shield?.kind === "national")
      drawNationalShield(ctx, mk.x * k, mk.y * k, mk.w * k, mk.shield.number);
    else if (mk.shield) drawPrefecturalShield(ctx, mk.x * k, mk.y * k, mk.w * k, mk.shield.number);
  }
  for (const label of layout.labels) drawNames(ctx, label, h, k);
  if (layout.spec.distance !== null) {
    ctx.fillStyle = WHITE;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = latinFont(0.38 * h, k);
    ctx.fillText(`${layout.spec.distance}m`, jx * k, (layout.stemBottom + 0.2 * h) * k);
  }
  return canvas;
}
