import type { Category, Poi } from "../data/schema";
import { t, type MessageKey } from "../i18n";

const METERS_PER_DEG_LAT = 111_320;

/** Heading-up radar of nearby POIs, the mission target and live buses. */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly colors: Map<string, string>;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    categories: Category[],
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.colors = new Map(categories.map((c) => [c.id, c.color]));
  }

  draw(opts: {
    lat: number;
    lon: number;
    heading: number; // radians, 0 = north, clockwise
    radius: number; // metres shown from centre to edge
    pois: readonly Poi[];
    target: Poi | null;
    buses: Array<{ lat: number; lon: number }>;
    /** カーナビ route, drawn under the markers. */
    route?: Array<{ lat: number; lon: number }>;
    /** 配車中のタクシー: where it is, its heading (as `heading`) and the way it is coming. */
    taxi?: { lat: number; lon: number; heading: number; route: Array<{ lat: number; lon: number }> } | null;
    /** 北が上: the map fixed with north up and the car turning on it (else the way ahead is up). */
    northUp?: boolean;
    /** An accident's scene, and the ambulance and the patrol car on their way to it. */
    incident?: { lat: number; lon: number } | null;
    responders?: Array<{ kind: "ambulance" | "police"; lat: number; lon: number }>;
  }): void {
    const { ctx, canvas } = this;
    const size = canvas.width;
    const half = size / 2;
    const scale = half / opts.radius;
    const cosLat = Math.cos((opts.lat * Math.PI) / 180);
    // The bearing at the top of the map: the car's heading, or north.
    const view = opts.northUp ? 0 : opts.heading;
    const project = (lat: number, lon: number): [number, number] => {
      const east = (lon - opts.lon) * METERS_PER_DEG_LAT * cosLat;
      const north = (lat - opts.lat) * METERS_PER_DEG_LAT;
      const c = Math.cos(view);
      const s = Math.sin(view);
      return [half + (east * c - north * s) * scale, half - (east * s + north * c) * scale];
    };

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(10,18,30,0.72)";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    for (const r of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.arc(half, half, half * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (opts.route && opts.route.length > 1) {
      ctx.strokeStyle = "#3d8bff";
      ctx.lineWidth = 4;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      opts.route.forEach((p, i) => {
        const [x, y] = project(p.lat, p.lon);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    if (opts.taxi && opts.taxi.route.length > 1) {
      ctx.strokeStyle = "rgba(255,210,60,0.85)";
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      opts.taxi.route.forEach((p, i) => {
        const [x, y] = project(p.lat, p.lon);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }
    for (const p of opts.pois) {
      const [x, y] = project(p.lat, p.lon);
      ctx.fillStyle = this.colors.get(p.category) ?? "#fff";
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    ctx.fillStyle = "#3fbf6a";
    for (const b of opts.buses) {
      const [x, y] = project(b.lat, b.lon);
      ctx.fillRect(x - 3, y - 1.5, 6, 3);
    }
    if (opts.target) {
      let [x, y] = project(opts.target.lat, opts.target.lon);
      const dx = x - half;
      const dy = y - half;
      const d = Math.hypot(dx, dy);
      const edge = half - 10;
      if (d > edge) {
        x = half + (dx / d) * edge;
        y = half + (dy / d) * edge;
      }
      ctx.fillStyle = "#ffe14d";
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (opts.taxi) {
      // Clamped to the rim like the target, so a taxi further out still shows its direction.
      let [x, y] = project(opts.taxi.lat, opts.taxi.lon);
      const dx = x - half;
      const dy = y - half;
      const d = Math.hypot(dx, dy);
      const edge = half - 10;
      if (d > edge) {
        x = half + (dx / d) * edge;
        y = half + (dy / d) * edge;
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(opts.taxi.heading - view);
      ctx.fillStyle = "#ffd23c";
      ctx.strokeStyle = "#1d2a4a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-5, -8, 10, 16, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#1d2a4a";
      ctx.fillRect(-3, -6, 6, 3); // windscreen: the front
      ctx.restore();
    }
    // The scene and the vehicles coming to it, clamped to the rim like the target so a vehicle still
    // far off shows the way it comes from. The siren's red blinks on the patrol car.
    const clamp = (lat: number, lon: number): [number, number] => {
      const [x, y] = project(lat, lon);
      const d = Math.hypot(x - half, y - half);
      const edge = half - 10;
      return d > edge ? [half + ((x - half) / d) * edge, half + ((y - half) / d) * edge] : [x, y];
    };
    if (opts.incident) {
      const [x, y] = clamp(opts.incident.lat, opts.incident.lon);
      ctx.fillStyle = "#ff4d4d";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x + 7, y + 5);
      ctx.lineTo(x - 7, y + 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.fillRect(x - 1, y - 3, 2, 4);
      ctx.fillRect(x - 1, y + 2, 2, 1.5);
    }
    const blink = Math.floor(performance.now() / 300) % 2 === 0;
    for (const r of opts.responders ?? []) {
      const [x, y] = clamp(r.lat, r.lon);
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = r.kind === "police" ? "#1d2a4a" : "#d22";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x - 6, y - 6, 12, 12, 3);
      ctx.fill();
      ctx.stroke();
      if (r.kind === "ambulance") {
        // A red cross on white.
        ctx.fillStyle = "#d22";
        ctx.fillRect(x - 1.5, y - 4, 3, 8);
        ctx.fillRect(x - 4, y - 1.5, 8, 3);
      } else {
        ctx.fillStyle = blink ? "#ff3030" : "#1d2a4a";
        ctx.fillRect(x - 4, y - 4, 8, 3);
        ctx.fillStyle = "#1d2a4a";
        ctx.fillRect(x - 4, y + 1, 8, 3);
      }
    }
    this.drawCompass(half, view, opts.heading);
    ctx.restore();

    // The car, pointing where it heads.
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(opts.heading - view);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * The compass on the rim: ticks every 30°, 東 南 西 in white and 北 on a red disc (the map turns,
   * so north has to stand out wherever it is), and the way the car heads in words under it.
   */
  private drawCompass(half: number, view: number, heading: number): void {
    const { ctx } = this;
    const at = (bearing: number, r: number): [number, number] => [
      half + Math.sin(bearing - view) * r,
      half - Math.cos(bearing - view) * r,
    ];
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1.5;
    for (let deg = 0; deg < 360; deg += 30) {
      const b = (deg * Math.PI) / 180;
      const isCardinal = deg % 90 === 0;
      const [x0, y0] = at(b, half - 3);
      const [x1, y1] = at(b, half - (isCardinal ? 10 : 7));
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [key, deg] of [
      ["compass.e", 90],
      ["compass.s", 180],
      ["compass.w", 270],
    ] as const) {
      const [x, y] = at((deg * Math.PI) / 180, half - 19);
      ctx.font = "bold 12px system-ui";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(t(key), x, y);
    }
    const [nx, ny] = at(0, half - 20);
    ctx.fillStyle = "#e53935";
    ctx.beginPath();
    ctx.arc(nx, ny, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px system-ui";
    ctx.fillText(t("compass.n"), nx, ny + 0.5);
    // The heading in words, on a pill under the car (the rim's bottom letter stays readable).
    const text = t("compass.toward", { dir: compassLabel(heading) });
    ctx.font = "bold 12px system-ui";
    const w = ctx.measureText(text).width + 14;
    const y = half + 26;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.roundRect(half - w / 2, y - 9, w, 18, 9);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(text, half, y);
  }
}

/** Clockwise from north: 北 北東 … / N NE … / 北 东北 … (Chinese names the east or west first). */
const COMPASS_8: readonly MessageKey[] = [
  "compass.n",
  "compass.ne",
  "compass.e",
  "compass.se",
  "compass.s",
  "compass.sw",
  "compass.w",
  "compass.nw",
];

/** The eight-point compass name of a heading (radians, 0 = north, clockwise), in the language in force. */
export function compassLabel(heading: number): string {
  const turn = (((heading / (Math.PI * 2)) % 1) + 1) % 1;
  return t(COMPASS_8[Math.round(turn * 8) % 8] ?? "compass.n");
}
