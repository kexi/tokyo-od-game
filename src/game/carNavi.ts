import type { Vector3 } from "three";
import { t } from "../i18n";
import type { RoadGraph, Segment } from "../world/roads";
import type { Route } from "./navigation";
import { TURN_ARROWS } from "./navGuide";

/**
 * カーナビ on the cockpit's centre display: a heading-up map of the streets around the car drawn
 * from the road graph (widths to scale, national roads yellow, expressways green), the route ahead
 * in blue, the car's arrow low in the frame so more of the road ahead shows, the next turn with its
 * distance, the place, the limit in force and the clock. Night switches to the dark palette as
 * navigation units do with the headlights.
 *
 * Why not the HUD minimap's canvas: it is a radar of POIs and the route over a translucent disc,
 * with no streets, and it is round.
 */
const W = 640;
const H = 400; // the display is 228 × 140 mm
const CAR_X = W / 2;
const CAR_Y = H * 0.7;
const REDRAW_MS = 120;

type Palette = {
  ground: string;
  block: string;
  casing: string;
  road: string;
  nationalCasing: string;
  national: string;
  highwayCasing: string;
  highway: string;
  panel: string;
  text: string;
};

const DAY: Palette = {
  ground: "#d9d4c7",
  block: "#cdc7b8",
  casing: "#8f949e",
  road: "#ffffff",
  nationalCasing: "#d6a83a",
  national: "#ffe28a",
  highwayCasing: "#4f9a58",
  highway: "#8fd39a",
  panel: "rgba(18,24,34,0.88)",
  text: "#ffffff",
};

const NIGHT: Palette = {
  ground: "#141b26",
  block: "#1b2431",
  casing: "#0b1018",
  road: "#4a5568",
  nationalCasing: "#3e3216",
  national: "#8a7232",
  highwayCasing: "#163a22",
  highway: "#2f6b42",
  panel: "rgba(6,10,16,0.9)",
  text: "#e8edf5",
};

export type CarNaviState = {
  now: number;
  graph: RoadGraph | null;
  route: Route | null;
  /** Distance travelled along the route (NavGuide.lastAt). */
  at: number;
  pos: Vector3;
  /** Vehicle yaw: forward is (sin yaw, cos yaw) on the ground plane. */
  yaw: number;
  night: boolean;
  kmh: number;
  limit: number | null;
  place: string;
  clock: string;
  /** The TV playing behind the map (「♪ 10ch」, game/naviTv.ts), or nothing. */
  tv?: string | null;
};

export class CarNavi {
  readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D | null;
  private drawnAt = -Infinity;
  private readonly arrows = new Map<string, Path2D>();

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d");
  }

  /** Redraws at most every 120 ms, or immediately when reclaiming the canvas from TV. */
  draw(s: CarNaviState, force = false): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const isFresh = !force && s.now - this.drawnAt < REDRAW_MS;
    if (isFresh) return false;
    this.drawnAt = s.now;
    const pal = s.night ? NIGHT : DAY;
    // Zoom out with speed: ~250 m ahead at a standstill, ~550 m at 100 km/h.
    const mPerPx = 0.9 + Math.min(120, s.kmh) / 85;
    const fwdX = Math.sin(s.yaw);
    const fwdZ = Math.cos(s.yaw);
    // Screen right is the driver's right: the negation of vehicle-left (fwd.z, −fwd.x).
    const toScreen = (p: Vector3): [number, number] => {
      const dx = p.x - s.pos.x;
      const dz = p.z - s.pos.z;
      const ahead = dx * fwdX + dz * fwdZ;
      const right = -(dx * fwdZ - dz * fwdX);
      return [CAR_X + right / mPerPx, CAR_Y - ahead / mPerPx];
    };

    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, 0, W, H);
    const reach = Math.hypot(W, H) * mPerPx;
    if (s.graph) this.drawRoads(ctx, s.graph, s.pos, reach, mPerPx, pal, toScreen);
    if (s.route) this.drawRoute(ctx, s.route, s.at, toScreen);
    this.drawCar(ctx);
    this.drawPanels(ctx, s, pal);
    return true;
  }

  private drawRoads(
    ctx: CanvasRenderingContext2D,
    graph: RoadGraph,
    pos: Vector3,
    reach: number,
    mPerPx: number,
    pal: Palette,
    toScreen: (p: Vector3) => [number, number],
  ): void {
    const near: Segment[] = [];
    for (const seg of graph.segments) {
      const a = seg.pts[0];
      const isFar = Math.hypot(a.x - pos.x, a.z - pos.z) - seg.length > reach;
      if (!isFar) near.push(seg);
    }
    const style = (seg: Segment): [string, string] => {
      if (seg.line.kind === "highway") return [pal.highwayCasing, pal.highway];
      if (seg.line.kind === "national") return [pal.nationalCasing, pal.national];
      return [pal.casing, pal.road];
    };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Casings first so crossing streets read as joined, minor roads under major ones.
    const order = (seg: Segment) =>
      ({ narrow: 0, local: 1, prefectural: 2, national: 3, highway: 4 })[seg.line.kind];
    near.sort((a, b) => order(a) - order(b));
    for (const pass of [0, 1] as const) {
      for (const seg of near) {
        const widthPx = Math.max(2, seg.line.width / mPerPx);
        ctx.strokeStyle = style(seg)[pass];
        ctx.lineWidth = pass === 0 ? widthPx + 2.5 : widthPx;
        ctx.beginPath();
        seg.pts.forEach((p, i) => {
          const [x, y] = toScreen(p);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    }
  }

  private drawRoute(
    ctx: CanvasRenderingContext2D,
    route: Route,
    at: number,
    toScreen: (p: Vector3) => [number, number],
  ): void {
    const start = Math.max(
      0,
      route.cum.findIndex((c) => c > at),
    );
    const ahead = route.points.slice(Math.max(0, start - 1));
    if (ahead.length < 2) return;
    const path = () => {
      ctx.beginPath();
      ahead.forEach((p, i) => {
        const [x, y] = toScreen(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
    };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 11;
    path();
    ctx.stroke();
    ctx.strokeStyle = "#2f63e6";
    ctx.lineWidth = 7;
    path();
    ctx.stroke();
  }

  /** The car: a red arrowhead with a white rim, pointing up (heading-up map). */
  private drawCar(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(CAR_X, CAR_Y);
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(11, 11);
    ctx.lineTo(0, 5);
    ctx.lineTo(-11, 11);
    ctx.closePath();
    ctx.fillStyle = "#e3262f";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  private drawPanels(ctx: CanvasRenderingContext2D, s: CarNaviState, pal: Palette): void {
    const font = '"Noto Sans JP", system-ui, sans-serif';
    // Next turn: arrow and distance, top left.
    const next = s.route?.maneuvers.find((m) => m.at > s.at + 2);
    if (next) {
      ctx.fillStyle = pal.panel;
      roundRect(ctx, 12, 12, 150, 118, 12);
      ctx.fill();
      const glyph = this.arrow(TURN_ARROWS[next.turn]);
      ctx.save();
      ctx.translate(39, 18);
      ctx.scale(1.6, 1.6);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(glyph);
      ctx.restore();
      const metres = Math.max(0, next.at - s.at);
      const label = metres >= 1000 ? `${(metres / 1000).toFixed(1)}km` : `${Math.round(metres / 10) * 10}m`;
      ctx.fillStyle = pal.text;
      ctx.font = `700 30px ${font}`;
      ctx.textAlign = "center";
      ctx.fillText(label, 87, 122);
    }
    // Remaining distance to the destination and the clock, top right.
    ctx.fillStyle = pal.panel;
    roundRect(ctx, W - 176, 12, 164, 64, 12);
    ctx.fill();
    ctx.fillStyle = pal.text;
    ctx.textAlign = "right";
    ctx.font = `700 26px ${font}`;
    ctx.fillText(s.clock, W - 24, 42);
    if (s.route) {
      const left = Math.max(0, s.route.length - s.at);
      ctx.font = `400 16px ${font}`;
      ctx.fillText(t("carNavi.toGoal", { km: (left / 1000).toFixed(1) }), W - 24, 66);
    }
    // The TV's sound playing behind the map, under the clock.
    if (s.tv) {
      ctx.fillStyle = pal.panel;
      roundRect(ctx, W - 112, 84, 100, 32, 10);
      ctx.fill();
      ctx.fillStyle = "#7dff9a";
      ctx.font = `700 18px ${font}`;
      ctx.fillText(s.tv, W - 24, 107);
    }
    // Where the car is, along the bottom, with the limit in force.
    ctx.fillStyle = pal.panel;
    ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = pal.text;
    ctx.textAlign = "left";
    ctx.font = `500 19px ${font}`;
    ctx.fillText(s.place, 66, H - 13, W - 90);
    if (s.limit !== null) {
      ctx.beginPath();
      ctx.arc(32, H - 20, 16, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#d8232a";
      ctx.stroke();
      ctx.fillStyle = "#1a4fb3";
      ctx.font = `700 15px ${font}`;
      ctx.textAlign = "center";
      ctx.fillText(String(s.limit), 32, H - 15);
    }
  }

  private arrow(d: string): Path2D {
    let p = this.arrows.get(d);
    if (!p) {
      p = new Path2D(d);
      this.arrows.set(d, p);
    }
    return p;
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
