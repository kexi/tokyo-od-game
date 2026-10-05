import { Vector3 } from "three";
import type { RoadGraph } from "../world/roads";
import { fitCanvas } from "./navMap";
import type { Maneuver, Route } from "./navigation";

/**
 * 交差点拡大図 like Japanese car navigation: the real streets round the next turn drawn from the
 * road graph, turned so the car comes in from the bottom, with the route as a big arrow over
 * them, the junction's name, and a bar counting down the distance.
 */
const VIEW_M = 70; // metres from the junction to the panel edge
const ARROW_BEFORE = 45;
const ARROW_AFTER = 38;
const BAR_M = 300;

export function drawJunction(
  canvas: HTMLCanvasElement,
  graph: RoadGraph,
  route: Route,
  /** The turn, or a junction passed straight on (直進案内). */
  next: Pick<Maneuver, "at" | "pos" | "dir">,
  at: number,
  name: string | null,
): void {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, w, h } = fit;
  const scale = (Math.min(w, h) * 0.46) / VIEW_M;
  // Line widths and letters were drawn for a 240-px view; the panel's picture is smaller.
  const k = Math.min(1, Math.min(w, h) / 240);
  const centre = next.pos;
  // The street's direction arriving at the junction points up on the panel (the path itself is
  // in the lane and already curving there).
  const inDir = next.dir.clone().setY(0);
  if (inDir.lengthSq() < 1e-6) inDir.set(0, 0, -1);
  inDir.normalize();
  // Screen: up = inDir, right = inDir turned clockwise seen from above (x east, z south).
  const right = new Vector3(-inDir.z, 0, inDir.x);
  const cx = w / 2;
  const cy = h * 0.52;
  const project = (p: Vector3): [number, number] => {
    const dx = p.x - centre.x;
    const dz = p.z - centre.z;
    return [cx + (dx * right.x + dz * right.z) * scale, cy - (dx * inDir.x + dz * inDir.z) * scale];
  };

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#0d2346");
  sky.addColorStop(1, "#122f5c");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Streets near the junction, widest first so narrow ones draw on top of them at the corners.
  const near = graph.segments
    .filter((seg) => seg.line.kind !== "highway" && seg.pts.some((p) => p.distanceTo(centre) < VIEW_M * 1.5))
    .toSorted((a, b) => b.line.width - a.line.width);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const pass of ["edge", "fill"] as const) {
    for (const seg of near) {
      ctx.beginPath();
      seg.pts.forEach((p, i) => {
        const [x, y] = project(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      const px = Math.max(5, seg.line.width * scale);
      ctx.strokeStyle = pass === "edge" ? "#c8d2e0" : "#5d6a7e";
      ctx.lineWidth = pass === "edge" ? px + 3 : px;
      ctx.stroke();
    }
  }

  // The route: white outline, bright body, arrowhead after the turn.
  const pts: Array<[number, number]> = [];
  for (
    let d = Math.max(0, next.at - ARROW_BEFORE);
    d <= Math.min(route.length, next.at + ARROW_AFTER);
    d += 2
  ) {
    pts.push(project(pointAt(route, d)));
  }
  if (pts.length >= 2) {
    const [ex, ey] = pts[pts.length - 1];
    const [px, py] = pts[pts.length - 3] ?? pts[0];
    const ang = Math.atan2(ey - py, ex - px);
    const shaft = pts.slice(0, -2);
    for (const [colour, full] of [
      ["#ffffff", 26],
      ["#1f8fff", 17],
    ] as const) {
      const width = Math.max(4, full * k);
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      shaft.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
      const size = width * 1.25;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(ang) * size * 0.35, ey + Math.sin(ang) * size * 0.35);
      ctx.lineTo(ex - Math.cos(ang - 0.62) * size, ey - Math.sin(ang - 0.62) * size);
      ctx.lineTo(ex - Math.cos(ang + 0.62) * size, ey - Math.sin(ang + 0.62) * size);
      ctx.closePath();
      ctx.fill();
    }
  }

  // The car, while it is inside the view.
  const car = pointAt(route, at);
  const [carX, carY] = project(car);
  if (carY < h - 6) {
    ctx.fillStyle = "#ffd23c";
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(carX, carY - 9);
    ctx.lineTo(carX + 7, carY + 7);
    ctx.lineTo(carX - 7, carY + 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Name band and the countdown bar.
  const band = Math.round(Math.max(22, 34 * k));
  if (name) {
    ctx.fillStyle = "rgba(4, 14, 30, 0.82)";
    ctx.fillRect(0, 0, w, band);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(Math.max(13, 20 * k))}px "Noto Sans JP", "Hiragino Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Long names shrink to fit the band rather than run off it.
    ctx.fillText(name, w / 2, band / 2 + 1, w - 28);
  }
  const left = Math.max(0, Math.min(BAR_M, next.at - at));
  const barTop = name ? band + 8 : 12;
  const barH = h - barTop - 12;
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(w - 16, barTop, 8, barH);
  ctx.fillStyle = "#1f8fff";
  ctx.fillRect(w - 16, barTop + barH * (1 - left / BAR_M), 8, barH * (left / BAR_M));
}

/** Point on the route's path (by car: in the lane, round the corners) at route distance d. */
export function pointAt(route: Route, d: number): Vector3 {
  let i = 1;
  while (i < route.cum.length - 1 && route.cum[i] < d) i++;
  const a = route.points[i - 1];
  const b = route.points[i];
  const t = (d - route.cum[i - 1]) / Math.max(1e-6, route.cum[i] - route.cum[i - 1]);
  return a.clone().lerp(b, Math.min(1, Math.max(0, t)));
}
