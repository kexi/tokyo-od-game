/**
 * Developing a bystander's photo (witnessShot.ts) from the pixels read back from the GPU: the
 * phone's processing on the raw frame. Plain functions on arrays and a 2D context, shared by the
 * darkroom worker (darkroom.worker.ts) and the main-thread fallback (darkroom.ts), so this module
 * imports nothing of the game (the worker's bundle stays small).
 */

/** How this poster's device renders the picture (from cameraFor and where they stood). */
export type Look = {
  /** Exposure compensation (1 = none). */
  exposure: number;
  /** White balance: + warm (red up, blue down), − cool. */
  warmth: number;
  /** Sensor noise, 0…1. */
  noise: number;
  /** Roll of the frame (radians). */
  tilt: number;
  /** Barrel distortion (a dashcam's wide lens). */
  barrel: number;
  /** Softness in pixels (far and zoomed in, hand-held). */
  blur: number;
  /** Panning streak in pixels (following a fast car). */
  streak: number;
  seed: number;
  /** A dashcam's time stamp, burnt in at the lower left. */
  stamp: string | null;
};

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Canvas = HTMLCanvasElement | OffscreenCanvas;

/**
 * The phone's processing of the raw frame (rw×rh RGBA, rows bottom-up as GL reads them) into a
 * w×h picture (RGBA, rows top-down): tilt (zoomed to fill the corners), barrel, auto exposure
 * (dark scenes are lifted, and get grainier for it), white balance, grain, vignette. Rows
 * [from, to) only, into `out` (w×h×4); returns the grain's random state after them, to pass as
 * `seed` for the rows that follow (the same picture whether developed at once or in slices).
 */
export function developRows(
  src: Uint8Array,
  rw: number,
  rh: number,
  w: number,
  h: number,
  look: Look,
  out: Uint8ClampedArray,
  from = 0,
  to = h,
  seed = look.seed >>> 0,
): number {
  const { gr, gain, gb, grain } = toneOf(src, look);
  const cos = Math.cos(look.tilt);
  const sin = Math.sin(look.tilt);
  const long = Math.max(w, h) / Math.min(w, h);
  const zoom = Math.abs(cos) + long * Math.abs(sin);
  const corner = 1 + (h / w) ** 2;
  const half = w / 2;
  const scale = rw / w;
  let s = seed >>> 0;
  for (let y = from; y < to; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5 - half) / half;
      const v = (y + 0.5 - h / 2) / half;
      const r2 = u * u + v * v;
      // The barrel magnifies the middle and squeezes the edges (corners stay put).
      const b = (1 + look.barrel * r2) / (1 + look.barrel * corner);
      // Image y runs down, so the roll turns the other way round on screen.
      const su = ((u * cos + v * sin) / zoom) * b;
      const sv = ((-u * sin + v * cos) / zoom) * b;
      const sx = Math.min(rw - 1.001, Math.max(0, rw / 2 + su * half * scale - 0.5));
      // GL rows run bottom-up.
      const sy = Math.min(rh - 1.001, Math.max(0, rh / 2 - sv * half * scale - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * rw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + rw * 4;
      const i11 = i01 + 4;
      s = (s * 1664525 + 1013904223) >>> 0;
      const n = ((s >>> 8) / 0x1000000 - 0.5) * grain;
      const vignette = 1 - 0.22 * r2;
      const k = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
        const bottom = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
        const g = c === 0 ? gr : c === 2 ? gb : gain;
        out[k + c] = (top * (1 - fy) + bottom * fy) * g * vignette + n;
      }
      out[k + 3] = 255;
    }
  }
  return s;
}

/** Auto exposure from the frame's mean brightness (every 53rd pixel), white balance and grain. */
function toneOf(src: Uint8Array, look: Look): { gr: number; gain: number; gb: number; grain: number } {
  let luma = 0;
  let samples = 0;
  for (let i = 0; i < src.length; i += 4 * 53) {
    luma += 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
    samples++;
  }
  const mean = luma / Math.max(1, samples) / 255;
  const auto = Math.min(2.2, Math.max(0.85, 0.42 / Math.max(0.03, mean)));
  const gain = auto * look.exposure;
  return {
    gr: gain * (1 + look.warmth),
    gain,
    gb: gain * (1 - look.warmth),
    grain: look.noise * (5 + 16 * (auto - 0.85)),
  };
}

/**
 * The rest, on the picture already in `canvas`: softness, the pan streak and a dashcam's time
 * stamp. `blank(w, h)` makes a scratch canvas of the same kind.
 */
export function finishPhoto(
  ctx: Ctx2D,
  canvas: Canvas,
  look: Look,
  blank: (w: number, h: number) => Canvas,
): void {
  const { width: w, height: h } = canvas;
  if (look.blur > 0) soften(ctx, canvas, look.blur, blank);
  if (look.streak > 0.5) {
    ctx.globalAlpha = 0.3;
    ctx.drawImage(canvas, look.streak, 0);
    ctx.drawImage(canvas, -look.streak, 0);
    ctx.globalAlpha = 1;
  }
  if (!look.stamp) return;
  ctx.font = `700 ${Math.round(w / 40)}px ui-monospace, Menlo, monospace`;
  ctx.textBaseline = "bottom";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.fillStyle = "#f4f4f4";
  ctx.strokeText(look.stamp, 12, h - 10);
  ctx.fillText(look.stamp, 12, h - 10);
}

/** Box-softens the picture by drawing it smaller and back (cheap, like an out-of-focus zoom). */
function soften(ctx: Ctx2D, canvas: Canvas, px: number, blank: (w: number, h: number) => Canvas): void {
  const small = blank(
    Math.max(1, Math.round(canvas.width / (1 + px))),
    Math.max(1, Math.round(canvas.height / (1 + px))),
  );
  const sctx = small.getContext("2d") as Ctx2D | null;
  sctx?.drawImage(canvas, 0, 0, small.width, small.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
}

/** JPEG quality of a developed photo. */
export const PHOTO_QUALITY = 0.8;
