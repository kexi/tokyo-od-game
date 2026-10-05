import { Vector3 } from "three";
import { t } from "../i18n";
import type { RoadGraph, Segment } from "../world/roads";
import type { AheadStep } from "./navAhead";
import type { Route, TravelMode } from "./navigation";

/**
 * The nav panel's picture when no 交差点拡大図 is due: a small heading-up map of the streets round
 * the player from the road graph, the route ahead in blue (or, with no route, the street being
 * followed lit up), the next turn, the goal, and the car low in the frame so more of the way ahead
 * shows. Same palette as the junction view, so the two read as one screen.
 *
 * Why not the cockpit display's map (carNavi.ts): it draws a 640 × 400 day/night screen with its
 * own panels for the 3D dashboard; this is a 250-px HUD picture in the panel's dark style.
 */

/** Size the canvas's backing store to its CSS box (up to 2× for sharp lines) and scale to CSS px. */
export function fitCanvas(
  canvas: HTMLCanvasElement,
): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(bw / w, 0, 0, bh / h, 0, 0);
  return { ctx, w, h };
}

export type RouteMapState = {
  graph: RoadGraph | null;
  car: Vector3;
  /** The way the player faces (ground plane): up on the map. */
  forward: Vector3;
  route: Route | null;
  /** Route distance of the player. */
  at: number;
  /** The next guidance point (turn or straight-on junction). */
  next: Vector3 | null;
  goal: Vector3 | null;
  /** The street followed with no route. */
  follow: readonly AheadStep[] | null;
  mode: TravelMode;
  kmh: number;
};

const CAR_Y = 0.74; // the car's height in the frame (from the top)

/** Drawn wider and lighter: 国道・都道 and other wide streets. */
const isMain = (seg: Segment) =>
  seg.line.kind === "national" || seg.line.kind === "prefectural" || seg.line.width >= 11;

export function drawRouteMap(canvas: HTMLCanvasElement, s: RouteMapState): void {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, w, h } = fit;
  // Metres per pixel: zoomed in on foot, out with speed by car (≈ 200 m ahead at rest, 370 at 100 km/h).
  const mPerPx = s.mode === "walk" ? 0.9 : 1.7 + Math.min(100, Math.abs(s.kmh)) / 70;
  const up = s.forward.clone().setY(0);
  if (up.lengthSq() < 1e-6) up.set(0, 0, -1);
  up.normalize();
  // Screen right is the player's right: up turned clockwise seen from above (x east, z south).
  const right = new Vector3(-up.z, 0, up.x);
  const cx = w / 2;
  const cy = h * CAR_Y;
  const project = (p: Vector3): [number, number] => {
    const dx = p.x - s.car.x;
    const dz = p.z - s.car.z;
    return [cx + (dx * right.x + dz * right.z) / mPerPx, cy - (dx * up.x + dz * up.z) / mPerPx];
  };
  const line = (pts: readonly Vector3[]) => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = project(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
  };

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#0d2346");
  sky.addColorStop(1, "#122f5c");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  if (!s.graph) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `bold 13px "Noto Sans JP", "Hiragino Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t("nav.mapLoading"), w / 2, h / 2);
    return;
  }

  // Streets in reach (the farthest corner of the frame), minor first so the main roads draw over
  // them at the junctions. Strokes are batched by colour and width (to the half pixel): a few
  // hundred streets cost a dozen strokes, not one each.
  const reach = Math.hypot(w / 2, Math.max(cy, h - cy)) * mPerPx;
  type Batch = { colour: string; width: number; path: Path2D };
  const layers: Array<Map<string, Batch>> = [new Map(), new Map(), new Map(), new Map()];
  const add = (layer: Map<string, Batch>, colour: string, width: number, pts: readonly Vector3[]) => {
    const px = Math.round(width * 2) / 2;
    const key = `${colour}|${px}`;
    let batch = layer.get(key);
    if (!batch) {
      batch = { colour, width: px, path: new Path2D() };
      layer.set(key, batch);
    }
    pts.forEach((p, i) => {
      const [x, y] = project(p);
      if (i === 0) batch.path.moveTo(x, y);
      else batch.path.lineTo(x, y);
    });
  };
  for (const seg of s.graph.segments) {
    if (seg.line.kind === "highway") continue;
    const a = seg.pts[0];
    const isFar = Math.hypot(a.x - s.car.x, a.z - s.car.z) - seg.length > reach;
    if (isFar) continue;
    const px = Math.max(1.5, seg.line.width / mPerPx);
    const main = isMain(seg);
    const fill = seg.closed ? "#7a3b46" : main ? "#62738f" : "#47566f";
    // Layers: minor edges, minor fills, main edges, main fills.
    add(layers[main ? 2 : 0], main ? "#9aa8bd" : "#3c4b63", px + (main ? 2.5 : 1.5), seg.pts);
    add(layers[main ? 3 : 1], fill, px, seg.pts);
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const layer of layers)
    for (const b of layer.values()) {
      ctx.strokeStyle = b.colour;
      ctx.lineWidth = b.width;
      ctx.stroke(b.path);
    }

  // The street followed with no route: lit so the way on reads at a glance.
  if (s.follow && !s.route) {
    ctx.strokeStyle = "rgba(160, 205, 255, 0.85)";
    ctx.lineWidth = 3;
    for (const st of s.follow) {
      line(st.seg.pts);
      ctx.stroke();
    }
  }

  // The route ahead: white outline and blue body, from just behind the car.
  if (s.route) {
    const r = s.route;
    let i = 0;
    while (i < r.cum.length - 1 && r.cum[i + 1] < s.at - 20) i++;
    const ahead = r.points.slice(i);
    if (ahead.length >= 2) {
      for (const [colour, width] of [
        ["#ffffff", 8],
        ["#1f8fff", 5],
      ] as const) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        line(ahead);
        ctx.stroke();
      }
    }
  }

  const dot = (p: Vector3, fill: string, stroke: string, r: number) => {
    const [x, y] = project(p);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  if (s.goal) dot(s.goal, "#ffd23c", "#1a1a1a", 6);
  if (s.next) dot(s.next, "#ffffff", "#1f8fff", 5);

  // The player: the junction view's yellow arrowhead, pointing up.
  ctx.fillStyle = "#ffd23c";
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 9);
  ctx.lineTo(cx + 7, cy + 7);
  ctx.lineTo(cx, cy + 3);
  ctx.lineTo(cx - 7, cy + 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // North: the map turns with the player, so a small compass shows where north is.
  const nx = -right.z; // north (0, 0, −1) on the screen's right and up axes
  const ny = up.z;
  const ox = w - 15;
  const oy = 15;
  ctx.fillStyle = "rgba(4, 14, 30, 0.75)";
  ctx.beginPath();
  ctx.arc(ox, oy, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#e53935";
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox + nx * 8, oy + ny * 8);
  ctx.stroke();
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox - nx * 8, oy - ny * 8);
  ctx.stroke();
}
