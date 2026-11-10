import type { BoxNode, Colour, Measure, Point } from "./boxes";
import type { ArmSpec, SignName } from "./content";
import { jpFont, MEASURE_K, NAME_H, nameWidth, spacedName } from "./fonts";
import { inArrowHeight, romanHeight } from "./letters";

/**
 * `junction-diagram` (108-A・108の2-A・108の3・108の4, and on green 108の2-C〜E): the arms of the
 * junction as arrows from a stem rising from the bottom, the place names at the arrow heads with
 * their English underneath at half the height (備考一(五)2), 国道番号 shields (118-A) and
 * 都道府県道番号 hexagons (118の2-A) on the arms, 通称名 in white boxes with blue letters (108の3・4,
 * 0.6 of the letter height, 備考一(五)3), 高速道路 names on green (備考一(三)1(13) ただし書) and, on
 * the 予告, the distance under the stem (図 016).
 *
 * Moved from src/world/guideArt.ts (G5) without changing a number: the same expressions in the
 * same order, so the boards of the five places surveyed draw pixel for pixel as before
 * (scripts/qa/guideBoards.ts). Why not tidy the arithmetic while moving it: floating-point sums
 * in another order move a box by a fraction of a pixel, and the comparison would no longer tell a
 * moved box from a rounding.
 */

type Box = { x: number; y: number; w: number; h: number };
/** A shield or a 通称名 box on an arm, centred at (x, y), all in cm. */
type Mark = { arm: ArmSpec; kind: "shield" | "street"; x: number; y: number; w: number; h: number };
type Tip = Point & { arm: ArmSpec; dx: number; dy: number };

export type JunctionInput = {
  arms: ArmSpec[];
  distance: number | null;
  letter: number;
  field: Colour;
};

const SHIELD = (h: number) => 1.15 * h; // 国道番号・都道府県道番号 on the arms

/** Direction of an arm on the board for its angle (+ left): up is straight on. */
export const armVector = (angle: number) => ({
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
export function layoutJunction(
  spec: JunctionInput,
  measure: Measure,
): { width: number; height: number; nodes: BoxNode[] } {
  const h = spec.letter;
  const m = 0.42 * h; // margin inside the rim
  const isAdvance = spec.distance !== null;
  const height = ((isAdvance ? 240 : 220) * h) / 30;
  const named = spec.arms.filter((a) => a.names.length > 0);
  const blockWidth = (a: ArmSpec, stack: boolean) => {
    const ws = a.names.map((n) => nameWidth(measure, n, h));
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

  const tips: Tip[] = spec.arms.map((arm) => {
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

  const HEAD_L = 0.62 * h;
  const marks: Array<Mark & { shield?: ArmSpec["shields"][number] }> = [];
  for (const t of tips) {
    const len = Math.hypot(t.x - jx, t.y - jy);
    // Street boxes half way out; shields nearer the junction, leaving the outer part to the names.
    const along = len * (t.arm.street ? 0.5 : 0.42);
    const mx = jx + t.dx * along;
    const my = jy + t.dy * along;
    if (t.arm.street) {
      const room = Math.max(2 * h, len - HEAD_L - 0.5 * h);
      const w = Math.min(
        measure(jpFont(inArrowHeight(h), MEASURE_K), t.arm.street) / MEASURE_K + 0.9 * h,
        room,
      );
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

  const labels: Array<{ names: SignName[]; box: Box; stack: boolean }> = [];
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

  // White on blue and on green alike (備考一(三)1(11)・(13)).
  const ink: Colour = "white";
  const nodes: BoxNode[] = [
    { type: "background", field: spec.field, letter: h },
    {
      type: "junction-arrows",
      colour: ink,
      letter: h,
      junction: { x: jx, y: jy },
      stemBottom,
      tips: tips.map(({ x, y, dx, dy }) => ({ x, y, dx, dy })),
    },
  ];
  // Shields and 通称名 boxes on the arms, half way out.
  for (const mk of marks) {
    if (mk.kind === "street" && mk.arm.street)
      nodes.push({ type: "street", x: mk.x, y: mk.y, w: mk.w, letter: h, text: mk.arm.street });
    else if (mk.shield) nodes.push({ type: "shield", x: mk.x, y: mk.y, size: mk.w, shield: mk.shield });
  }
  for (const label of labels) nodes.push(...nameNodes(label, h, measure, spec.field));
  if (spec.distance !== null)
    nodes.push({
      type: "text",
      text: `${spec.distance}m`,
      font: "latin",
      cm: 0.38 * h,
      x: jx,
      y: stemBottom + 0.2 * h,
      align: "center",
      baseline: "top",
      colour: ink,
      maxW: null,
    });
  return { width, height, nodes };
}

/** The names of one arm: side by side (straight on) or stacked, an expressway's on green. */
function nameNodes(
  label: { names: SignName[]; box: Box; stack: boolean },
  h: number,
  measure: Measure,
  field: Colour,
): BoxNode[] {
  const { box, names, stack } = label;
  const natural = names.map((n) => nameWidth(measure, n, h));
  // Side by side, the names share the box (condensed alike when they do not fit).
  const gap = 0.9 * h;
  const total = natural.reduce((sum, w) => sum + w, 0) + (names.length - 1) * gap;
  const squeeze = stack
    ? 1
    : Math.min(1, (box.w - (names.length - 1) * gap) / Math.max(1e-6, total - (names.length - 1) * gap));
  const widths = natural.map((w) => (stack ? Math.min(w, box.w) : w * squeeze));
  const used = widths.reduce((sum, w) => sum + w, 0) + (names.length - 1) * gap;
  let x = box.x + (stack ? 0 : (box.w - used) / 2);
  const out: BoxNode[] = [];
  names.forEach((n, i) => {
    const w = widths[i];
    const bx = stack ? box.x + (box.w - w) / 2 : x;
    const by = stack ? box.y + i * NAME_H(h) : box.y;
    const cx = bx + w / 2;
    const inner = w - (n.expressway ? 0.5 * h : 0);
    // 高速道路等の名称: white 区分線 round a green field (on a green board it is the board itself).
    const isPanel = n.expressway && field !== "green";
    if (isPanel)
      out.push({
        type: "field",
        x: bx,
        y: by - 0.08 * h,
        w,
        h: NAME_H(h) * 0.98,
        radius: 0.12 * h,
        fill: "green",
        stroke: { colour: "white", width: h / 20 },
      });
    out.push({
      type: "text",
      text: spacedName(n),
      font: "jp",
      cm: h,
      x: cx,
      y: by + 0.02 * h,
      align: "center",
      baseline: "top",
      colour: "white",
      maxW: inner,
    });
    if (n.en)
      out.push({
        type: "text",
        text: n.en,
        font: "latin",
        cm: romanHeight(h),
        x: cx,
        y: by + 1.1 * h,
        align: "center",
        baseline: "top",
        colour: "white",
        maxW: inner,
      });
    if (!stack) x += w + gap;
  });
  return out;
}
