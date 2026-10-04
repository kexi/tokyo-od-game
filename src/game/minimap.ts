import type { Category, Poi } from "../data/schema";

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
  }): void {
    const { ctx, canvas } = this;
    const size = canvas.width;
    const half = size / 2;
    const scale = half / opts.radius;
    const cosLat = Math.cos((opts.lat * Math.PI) / 180);
    const project = (lat: number, lon: number): [number, number] => {
      const east = (lon - opts.lon) * METERS_PER_DEG_LAT * cosLat;
      const north = (lat - opts.lat) * METERS_PER_DEG_LAT;
      const c = Math.cos(opts.heading);
      const s = Math.sin(opts.heading);
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
    // North marker rotates with heading.
    const [nx, ny] = project(opts.lat + (opts.radius * 0.85) / METERS_PER_DEG_LAT, opts.lon);
    ctx.fillStyle = "#ff6b6b";
    ctx.font = "bold 12px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("N", nx, ny);
    ctx.restore();

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(half, half - 8);
    ctx.lineTo(half + 6, half + 6);
    ctx.lineTo(half, half + 3);
    ctx.lineTo(half - 6, half + 6);
    ctx.closePath();
    ctx.fill();
  }
}
