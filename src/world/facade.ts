import {
  BufferAttribute,
  DataArrayTexture,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type MeshStandardMaterial,
} from "three";
import { GRAPHICS, QUALITY } from "../device";
import { geodeticToEcef } from "../geo/ellipsoid";
import type { LocalFrame } from "../geo/frame";
import { jstHour } from "../geo/sun";
import type { GraphicsSettings } from "../graphics";
import { gameClock, tokyoDate } from "./ruleTime";

/**
 * Textured façades for untextured PLATEAU LOD1 buildings. Eight wall styles drawn by
 * scripts/textures/building_textures.py (each tile = 12.8 m × 14 m: four 3.2 m bays × four
 * 3.5 m storeys) are packed into one texture array, colour in RGB and the window mask in A.
 * Each building gets a style chosen from its height and floors counted from its own base
 * (vertex attribute `facade`, computed when a tile loads).
 *
 * All in the one façade shader (no extra draw calls or geometry): windows lit by the hour and
 * the building's use, each with its own lamp colour, blind or curtain; a fake room behind each
 * lit window near the camera (interior mapping, not on phones); glass that reflects the sky;
 * walls darker where they meet the street; and wet walls with rain streaks.
 *
 * The horizontal pattern is computed from world position, which changes whenever the floating
 * origin is re-anchored. Adding the origin's offset modulo PERIOD keeps it glued to the city;
 * PERIOD is a multiple of the 12.8 m tile so the wrap is invisible.
 */
const PERIOD = 576; // = 12.8 × 45
const TILE_W = 12.8;
const TILE_H = 14.0;
/** Bays (one window each) in PERIOD: window ids wrap with it so re-anchoring keeps the lights. */
const BAYS_PER_PERIOD = (PERIOD / TILE_W) * 4;

// Texture-array layers, in this order.
const STYLES = [
  "office_glass",
  "office_concrete",
  "office_tile",
  "apartment_balcony",
  "apartment_small",
  "mixed_use",
  "metal_panel",
  "brick",
] as const;
const S = Object.fromEntries(STYLES.map((name, i) => [name, i])) as Record<(typeof STYLES)[number], number>;
// Weighted choices by building height (Tokyo: towers are glass or concrete offices, mid-rises
// mix offices and condominiums, low buildings are small apartments, 雑居ビル and warehouses).
const BY_HEIGHT: Array<[maxHeight: number, choices: Array<[number, number]>]> = [
  [
    12,
    [
      [S.apartment_small, 4],
      [S.mixed_use, 3],
      [S.metal_panel, 2],
      [S.brick, 1],
    ],
  ],
  [
    30,
    [
      [S.apartment_balcony, 3],
      [S.mixed_use, 3],
      [S.office_tile, 2],
      [S.apartment_small, 2],
    ],
  ],
  [
    60,
    [
      [S.office_concrete, 3],
      [S.office_tile, 2.5],
      [S.apartment_balcony, 2.5],
      [S.office_glass, 2],
    ],
  ],
  [
    Infinity,
    [
      [S.office_glass, 6],
      [S.office_concrete, 4],
    ],
  ],
];

/** What goes on behind a window, which decides when it is lit and how. */
export type WindowUse = "office" | "home" | "mixed" | "shop" | "works";
/** Index order of the uses in the shader. */
const USES: WindowUse[] = ["office", "home", "mixed", "shop", "works"];
/** Use behind each style's windows, in STYLES order (brick: low-rise flats). */
const USE_OF_STYLE: WindowUse[] = ["office", "office", "office", "home", "home", "mixed", "works", "home"];

/**
 * Share of a use's windows lit at each JST hour (index 0–23) on a working day; linear in between.
 * Offices follow the usual office lighting schedule (most lit 9–17 h, then falling through the
 * evening: about a third at 21 h, a tenth by 23 h, cleaners and night work after), stretched an
 * hour later for Tokyo's overtime; homes peak 19–22 h and empty out as people go to bed around
 * midnight; 雑居ビル (eateries, bars, clinics) stay busy late; shops close 20–22 h except
 * convenience stores and the like (about a tenth all night); warehouses and works keep day hours.
 * These are modelling assumptions (see knowledge/building-facade-shader.md), not survey data.
 */
const LIT_BY_HOUR: Record<WindowUse, number[]> = {
  // 0     1     2     3     4     5     6     7     8     9    10    11
  // 12   13    14    15    16    17    18    19    20    21    22    23
  office: [
    0.06, 0.05, 0.04, 0.04, 0.04, 0.05, 0.08, 0.25, 0.6, 0.85, 0.9, 0.9, 0.86, 0.9, 0.9, 0.9, 0.88, 0.8, 0.66,
    0.52, 0.4, 0.3, 0.19, 0.11,
  ],
  home: [
    0.24, 0.13, 0.07, 0.05, 0.05, 0.1, 0.3, 0.42, 0.28, 0.16, 0.13, 0.13, 0.15, 0.13, 0.13, 0.15, 0.24, 0.42,
    0.6, 0.7, 0.74, 0.72, 0.62, 0.43,
  ],
  mixed: [
    0.26, 0.18, 0.1, 0.06, 0.04, 0.04, 0.06, 0.15, 0.35, 0.6, 0.7, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.74,
    0.75, 0.72, 0.68, 0.6, 0.5, 0.38,
  ],
  shop: [
    0.12, 0.1, 0.1, 0.1, 0.1, 0.1, 0.14, 0.28, 0.5, 0.72, 0.9, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92,
    0.9, 0.84, 0.62, 0.42, 0.24,
  ],
  works: [
    0.05, 0.05, 0.05, 0.05, 0.05, 0.06, 0.1, 0.3, 0.7, 0.8, 0.8, 0.8, 0.75, 0.8, 0.8, 0.8, 0.78, 0.6, 0.36,
    0.2, 0.12, 0.08, 0.06, 0.05,
  ],
};
/** Saturdays, Sundays and 祝日: a few offices and works still have people in. */
const DAY_OFF_FACTOR: Record<WindowUse, number> = { office: 0.3, home: 1, mixed: 1, shop: 1, works: 0.4 };
/**
 * Chance a window follows its whole floor rather than itself: an office tenant lights a floor
 * at once; a block of flats is one household per window.
 */
export const FLOOR_CORRELATION: Record<WindowUse, number> = {
  office: 0.65,
  home: 0,
  mixed: 0.5,
  shop: 0.7,
  works: 0.8,
};

/** Share (0–1) of a use's windows lit at a JST hour (0–24, fractional). */
export function litShare(use: WindowUse, hour: number, isDayOff = false): number {
  const table = LIT_BY_HOUR[use];
  const h = ((hour % 24) + 24) % 24;
  const i = Math.floor(h);
  const share = table[i] + (table[(i + 1) % 24] - table[i]) * (h - i);
  return share * (isDayOff ? DAY_OFF_FACTOR[use] : 1);
}

const fround = Math.fround;
const fract32 = (v: number) => fround(v - Math.floor(v));

/** The shader's facadeHash (Dave Hoskins' hash12) in float32 arithmetic: 0 ≤ h < 1. */
export function facadeHash(x: number, y: number): number {
  let px = fract32(fround(x) * fround(0.1031));
  let py = fract32(fround(y) * fround(0.1031));
  let pz = px;
  const d = fround(
    fround(px * fround(py + 33.33)) + fround(py * fround(pz + 33.33)) + fround(pz * fround(px + 33.33)),
  );
  px = fround(px + d);
  py = fround(py + d);
  pz = fround(pz + d);
  return fract32(fround(fround(px + py) * pz));
}

/**
 * The value a window's lights are judged by (lit when below its share), as the shader computes
 * it: bay `cellX` and storey `cellY` on wall `face` (1–4) of the building with `tint` and `layer`.
 */
export function windowPick(
  cellX: number,
  cellY: number,
  face: number,
  tint: number,
  layer: number,
  correlation: number,
): number {
  const wx = fround((((cellX % BAYS_PER_PERIOD) + BAYS_PER_PERIOD) % BAYS_PER_PERIOD) + face * 211);
  const wy = fround(cellY + fround(tint * 977) + layer * 17);
  const isFloorWide = facadeHash(wx + 41.7, wy + 5.3) < correlation;
  return isFloorWide ? facadeHash(cellY + 0.5, fround(tint * 313) + face) : facadeHash(wx, wy);
}

const IMAGES = import.meta.glob<string>("../../assets/buildings/textures/facade_*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

export const facadeUniforms = {
  uNight: { value: 0 },
  uOrigin: { value: new Vector3() },
  uFacadeTex: { value: null as DataArrayTexture | null },
  /** Lit share per style (STYLES order), then for street-level shops. */
  uLitShare: { value: new Float32Array(STYLES.length + 1) },
  uWet: { value: 0 },
  /** Seconds, for the television flicker. */
  uTime: { value: 0 },
};

const JST_MS = 9 * 3600_000;
const DAY_MS = 86_400_000;
let dayKey = Number.NaN;
let isDayOff = false;

/** Per-frame: lit shares for the game's hour and day, the street wetness (0–1) and the time. */
export function updateFacadeClock(date: Date, wetness: number, seconds: number): void {
  // How: 祝日 only change at midnight (JST), so the calendar is looked up once per day.
  const key = Math.floor((date.getTime() + JST_MS) / DAY_MS);
  const isNewDay = key !== dayKey;
  if (isNewDay) {
    dayKey = key;
    const { y, m, d } = tokyoDate(date);
    const clock = gameClock(y, m, d, 0);
    isDayOff = clock.weekday === 0 || clock.weekday === 6 || clock.holiday;
  }
  const hour = jstHour(date);
  const shares = facadeUniforms.uLitShare.value;
  for (const [i, use] of USE_OF_STYLE.entries()) shares[i] = litShare(use, hour, isDayOff);
  shares[STYLES.length] = litShare("shop", hour, isDayOff);
  // 画質 › 雨の路面 なし: dry walls too.
  const isWetShown = GRAPHICS.settings.wetRoads !== "off";
  facadeUniforms.uWet.value = isWetShown ? wetness : 0;
  facadeUniforms.uTime.value = seconds;
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });

/** Packs every style's colour (RGB) and window mask (A) into one texture array. */
export async function loadFacadeTextures(): Promise<void> {
  // Phones get half resolution (2.3 MB of texture memory instead of 9 MB).
  const scale = QUALITY.isMobile ? 0.5 : 1;
  const width = 512 * scale;
  const height = 560 * scale;
  const data = new Uint8Array(width * height * 4 * STYLES.length);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("2D canvas unavailable");
  const pixels = async (file: string) => {
    const url = IMAGES[`../../assets/buildings/textures/${file}.png`];
    if (!url) throw new Error(`missing façade texture ${file}`);
    g.clearRect(0, 0, width, height);
    g.drawImage(await loadImage(url), 0, 0, width, height);
    return g.getImageData(0, 0, width, height).data;
  };
  for (const [layer, style] of STYLES.entries()) {
    const [color, mask] = [await pixels(`facade_${style}`), await pixels(`facade_${style}_mask`)];
    const base = layer * width * height * 4;
    for (let y = 0; y < height; y++) {
      // Canvas rows run top-down; texture rows bottom-up (v = 0 is the building's base).
      const src = (height - 1 - y) * width * 4;
      const dst = base + y * width * 4;
      for (let x = 0; x < width * 4; x += 4) {
        data[dst + x] = color[src + x];
        data[dst + x + 1] = color[src + x + 1];
        data[dst + x + 2] = color[src + x + 2];
        data[dst + x + 3] = mask[src + x];
      }
    }
  }
  const tex = new DataArrayTexture(data, width, height, STYLES.length);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = QUALITY.isMobile ? 2 : 8;
  tex.needsUpdate = true;
  facadeUniforms.uFacadeTex.value = tex;
}

const hash = (a: number, b: number) => {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

/**
 * Per-vertex `facade` = (style + tint, height above the building's base). `positions` are the
 * vertices in the tileset's ECEF frame; `idAt` gives each vertex's building within the tile.
 */
export function addFacadeAttribute(
  geometry: BufferGeometry,
  ecef: Float32Array,
  idAt: ((vertex: number) => number) | null,
): void {
  const count = geometry.getAttribute("position").count;
  // Local "up" for the tile: the radial direction at its centre (≤0.2° from the ellipsoid normal).
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < count; i++) {
    cx += ecef[i * 3];
    cy += ecef[i * 3 + 1];
    cz += ecef[i * 3 + 2];
  }
  const len = Math.hypot(cx, cy, cz) || 1;
  const [ux, uy, uz] = [cx / len, cy / len, cz / len];
  const heights = new Float32Array(count);
  const low = new Map<number, number>();
  const high = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const h = ecef[i * 3] * ux + ecef[i * 3 + 1] * uy + ecef[i * 3 + 2] * uz;
    heights[i] = h;
    const id = idAt ? Math.round(idAt(i)) : 0;
    low.set(id, Math.min(low.get(id) ?? Infinity, h));
    high.set(id, Math.max(high.get(id) ?? -Infinity, h));
  }
  // A tile-wide seed so the same batch id in different tiles gets an independent style.
  const seed = Math.round(cx / count) ^ Math.round(cz / count);
  const style = new Map<number, number>();
  for (const [id, lo] of low) {
    const tall = (high.get(id) ?? lo) - lo;
    const choices = (BY_HEIGHT.find(([max]) => tall <= max) ?? BY_HEIGHT[BY_HEIGHT.length - 1])[1];
    const total = choices.reduce((n, [, w]) => n + w, 0);
    let r = hash(seed, id) * total;
    let pick = choices[0][0];
    for (const [s, w] of choices) {
      if (r < w) {
        pick = s;
        break;
      }
      r -= w;
    }
    style.set(id, pick + 0.05 + 0.9 * hash(id, seed + 1)); // fractional part: brightness tint
  }
  const attr = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const id = idAt ? Math.round(idAt(i)) : 0;
    attr[i * 2] = style.get(id) ?? 0.5;
    attr[i * 2 + 1] = heights[i] - (low.get(id) ?? heights[i]);
  }
  geometry.setAttribute("facade", new BufferAttribute(attr, 2));
}

export function setFacadeOrigin(frame: LocalFrame): void {
  const o = geodeticToEcef(frame.origin.lat, frame.origin.lon, frame.origin.h);
  // Project the ECEF origin onto the frame's own axes (east/up/south) in metres.
  const e = frame.ecefToLocal.elements;
  const east = e[0] * o.x + e[4] * o.y + e[8] * o.z;
  const up = e[1] * o.x + e[5] * o.y + e[9] * o.z;
  const south = e[2] * o.x + e[6] * o.y + e[10] * o.z;
  const wrap = (v: number) => ((v % PERIOD) + PERIOD) % PERIOD;
  facadeUniforms.uOrigin.value.set(wrap(east), wrap(up), wrap(south));
}

const glslFloats = (values: number[]) => values.map((v) => v.toFixed(3)).join(", ");

/**
 * 画質 › 夜の窓: flat = the original single colour on a fixed 40 % of windows, lit = per-window
 * hours, colours and blinds, rooms = lit plus interior mapping near the camera.
 */
const WINDOW_DEFINES: Record<GraphicsSettings["windows"], string> = {
  flat: "",
  lit: "#define FACADE_WINDOWS_LIT",
  rooms: "#define FACADE_WINDOWS_LIT\n#define FACADE_INTERIOR",
};

// Declarations, the hash, lamp colours and the interior (after <common>).
const PARS = /* glsl */ `
varying vec2 vFacade;
varying vec3 vFacadePos;
varying vec3 vFacadeNormal;
uniform float uNight;
uniform vec3 uOrigin;
uniform highp sampler2DArray uFacadeTex;
uniform float uLitShare[${STYLES.length + 1}];
uniform float uWet;
uniform float uTime;
// Use behind each style (office 0, home 1, mixed 2, shop 3, works 4) and how much its windows go by floor.
const int FACADE_USE[${STYLES.length}] = int[${STYLES.length}](${USE_OF_STYLE.map((u) => USES.indexOf(u)).join(", ")});
const float FACADE_CORR[${USES.length}] = float[${USES.length}](${glslFloats(USES.map((u) => FLOOR_CORRELATION[u]))});
float facadeHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Lamp colour by colour temperature, k: 0 = 2700 K, .25 = 3500 K, .5 = 4000 K, .75 = 5000 K,
// 1 = 6500 K. Blackbody in linear sRGB, white-balanced a third of the way to 4000 K (as the eye
// or a camera at night sees it, so 電球色 reads amber, not orange).
vec3 facadeLampColor(float k) {
  float s = k * 4.0;
  vec3 c = mix(vec3(1.0, 0.49, 0.14), vec3(1.0, 0.668, 0.365), clamp(s, 0.0, 1.0));
  c = mix(c, vec3(1.0, 0.763, 0.532), clamp(s - 1.0, 0.0, 1.0));
  c = mix(c, vec3(1.0, 0.92, 0.885), clamp(s - 2.0, 0.0, 1.0));
  return mix(c, vec3(0.72, 0.78, 1.0), clamp(s - 3.0, 0.0, 1.0));
}
float facadeWall = 0.0;
float facadeWindow = 0.0;
float facadeLit = 0.0;       // 0/1 near, the building's lit share where windows are sub-pixel
float facadeClear = 1.0;     // 1 = clear glass, 0 = blind or curtain behind it
float facadeCurtainWall = 0.0;
float facadeStreak = 0.0;
float facadeAO = 1.0;
float facadeFar = 0.0;
float facadeRoomX = 0.0;
float facadeRoomCells = 1.0;
float facadeRoomDepth = 5.0;
float facadeRoomKind = 0.0;  // 1 = office or shop (ceiling panels, desks), 0 = home
vec2 facadeCellUv = vec2(0.0);
vec2 facadePane = vec2(0.0);
vec3 facadeTangent = vec3(1.0, 0.0, 0.0);
vec3 facadeLamp = vec3(0.0);
vec3 facadeBlindGlow = vec3(0.0);
vec3 facadeGlow = vec3(0.0);
vec4 facadeRoomSeed = vec4(0.0);
#ifdef FACADE_INTERIOR
// Interior mapping (van Dongen 2008): the eye ray carries on behind the glass into a box room
// (room width × 3.5 m × depth) and takes the colour of the back wall, side wall, ceiling or floor
// it reaches first, unless a furniture card standing part-way in is in front. p: entry point
// (0..1 across and up), d: ray direction in room units (z into the room), size: width and depth
// in metres. Returns radiance relative to the lamp.
vec3 facadeInterior(vec2 p, vec3 d, vec4 seed, float isOffice, vec2 size) {
  d.xy = mix(vec2(-1e-4), vec2(1e-4), step(0.0, d.xy)) + d.xy;
  vec3 o = vec3(p, 0.0);
  vec3 t3 = (step(0.0, d) - o) / d;
  float t = min(min(t3.x, t3.y), t3.z);
  vec3 h = o + d * t;
  vec3 wallColor = mix(vec3(0.55, 0.52, 0.47), vec3(0.82, 0.81, 0.78), seed.x);
  // Lit from the ceiling: the back wall brightest at the top, the side walls in shade, the floor
  // dim, the ceiling dark between its lamps (they shine down).
  vec3 c;
  if (t == t3.z) {
    c = wallColor * (0.22 + 0.6 * h.y * h.y);
  } else if (t == t3.x) {
    c = wallColor * (0.1 + 0.32 * h.y) * (1.0 - 0.5 * h.z);
  } else if (d.y > 0.0) {
    // Rows of light panels in offices, one round light in a home, each with a soft halo.
    vec2 m = h.xz * size;
    vec2 cellM = isOffice > 0.5 ? abs(fract(m / vec2(1.8, 2.4)) - 0.5) * vec2(1.8, 2.4) : abs(m - size * vec2(0.5, 0.45));
    vec2 lampHalf = isOffice > 0.5 ? vec2(0.3, 0.55) : vec2(0.28);
    float r = isOffice > 0.5 ? max(cellM.x - lampHalf.x, cellM.y - lampHalf.y) : length(cellM) - lampHalf.x;
    float panel = 1.0 - step(0.0, r);
    c = vec3(0.1) + vec3(0.35) * exp(-max(r, 0.0) * 3.0) + vec3(3.2) * panel;
  } else {
    // Floor: wood in homes, grey carpet in offices, a pool of light under the lamp.
    vec3 floorColor = isOffice > 0.5 ? vec3(0.3, 0.31, 0.33) : mix(vec3(0.42, 0.28, 0.16), vec3(0.55, 0.5, 0.42), seed.y);
    c = floorColor * (0.45 - 0.35 * length(h.xz - vec2(0.5, 0.45)));
  }
  // Furniture: desks with monitors in an office, a sofa back in a home, seen against the room.
  float tc = (0.3 + 0.35 * seed.z) / d.z;
  if (tc < t) {
    vec2 q = p + d.xy * tc;
    float top = isOffice > 0.5 ? 0.215 : 0.24 + 0.08 * seed.w;
    float x0 = isOffice > 0.5 ? 0.04 : 0.1 + 0.3 * seed.w;
    float x1 = isOffice > 0.5 ? 0.96 : x0 + 0.3 + 0.3 * seed.y;
    float isAcross = step(x0, q.x) * step(q.x, x1);
    float isMonitor = isOffice * step(abs(fract(q.x * size.x / 1.6) - 0.5), 0.15) * step(q.y, top + 0.13);
    float isBody = isAcross * max(step(q.y, top), isMonitor);
    if (isBody > 0.5) c = vec3(0.05, 0.048, 0.045) + 0.35 * wallColor * smoothstep(top - 0.03, top, q.y) * (1.0 - isMonitor * step(top, q.y));
  }
  return c * (1.0 - 0.55 * h.z);
}
#endif
`;

// Wall colour, which window this is and how it is lit, ground contact and rain (after <color_fragment>).
const COLOR = /* glsl */ `
{
  vec3 fp = vFacadePos + uOrigin;
  vec3 fn = normalize(vFacadeNormal);
  facadeWall = 1.0 - step(0.6, abs(fn.y));
  float layer = floor(vFacade.x);
  float tint = fract(vFacade.x);
  int style = int(layer + 0.5);
  bool isAlongZ = abs(fn.x) > abs(fn.z);
  // Along the wall: world x or z (whichever the wall runs along); up: height above the base.
  float along = isAlongZ ? fp.z : fp.x;
  facadeTangent = isAlongZ ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec2 uv = vec2(along / ${TILE_W.toFixed(1)}, vFacade.y / ${TILE_H.toFixed(1)});
  vec4 tex = texture(uFacadeTex, vec3(uv, layer));
  facadeWindow = facadeWall * smoothstep(0.4, 0.6, tex.a);
  facadeCurtainWall = style == 0 ? 1.0 : 0.0;
  // One window per bay and storey: 4 × 4 per tile. Ids wrap with PERIOD (see the top of the file).
  vec2 cellF = uv * 4.0;
  vec2 cell = floor(cellF);
  facadeCellUv = cellF - cell;
  facadePane = floor(cellF * vec2(4.0, 1.0));
  float face = isAlongZ ? (fn.x > 0.0 ? 1.0 : 2.0) : (fn.z > 0.0 ? 3.0 : 4.0);
  // Blinds and curtains drawn in the texture (light-coloured; not on curtain walls, whose light
  // panes are reflections): glass by day, a flat glow at night.
  float luma = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));
  float baked = facadeCurtainWall > 0.5 ? 0.0 : smoothstep(0.16, 0.34, luma);
  facadeClear = 1.0 - baked;
#ifdef FACADE_WINDOWS_LIT
  vec2 wid = vec2(mod(cell.x, ${BAYS_PER_PERIOD.toFixed(1)}) + face * 211.0, cell.y + tint * 977.0 + layer * 17.0);
  float building = facadeHash(vec2(tint * 531.0, layer + 7.0));
  // Street-level shops under offices and 雑居ビル, and under some blocks of flats (下駄履き).
  bool isShop = cell.y < 0.5 && (style <= 2 || style == 5 || (style == 3 && building < 0.4));
  int kind = isShop ? 3 : FACADE_USE[style];
  // Busier and quieter buildings around the hour's share; a tenant lights a whole floor at once.
  float share = clamp(uLitShare[isShop ? ${STYLES.length} : style] * (0.45 + building), 0.0, 0.97);
  bool isFloorWide = facadeHash(wid + vec2(41.7, 5.3)) < FACADE_CORR[kind];
  float pick = isFloorWide ? facadeHash(vec2(cell.y + 0.5, tint * 313.0 + face)) : facadeHash(wid);
  // Where a window is under a pixel, its average instead (no sparkling of distant towers).
  vec2 fw = fwidth(cellF);
  facadeFar = smoothstep(0.25, 0.8, max(fw.x, fw.y));
  facadeLit = mix(step(pick, share), share, facadeFar);

  // The room behind: open-plan offices span the tile, shops two bays, homes one.
  facadeRoomKind = kind == 0 || kind == 3 ? 1.0 : 0.0;
  facadeRoomCells = kind == 0 ? 4.0 : kind == 3 ? 2.0 : 1.0;
  facadeRoomDepth = kind == 0 ? 9.0 + 4.0 * building : kind == 3 ? 8.0 : 4.5 + 2.0 * building;
  float roomF = cellF.x / facadeRoomCells;
  facadeRoomX = fract(roomF);
  vec2 rid = vec2(mod(floor(roomF), ${BAYS_PER_PERIOD.toFixed(1)}) + face * 211.0, wid.y);
  facadeRoomSeed = vec4(facadeHash(rid + vec2(13.1, 3.7)), facadeHash(rid + vec2(27.3, 9.1)), facadeHash(wid + vec2(7.9, 21.5)), facadeHash(rid + vec2(3.3, 17.7)));
  float hk = facadeRoomSeed.x;
  float hb = facadeRoomSeed.y;
  float hc = facadeRoomSeed.z;
  // Colour temperature: offices 4500–6500 K; homes mix 電球色 (2700 K) with 昼白色/昼光色 ceiling
  // lights; shops bright white; 雑居ビル anything. Far away, the use's average.
  float k = kind == 0 ? 0.62 + 0.38 * hk
          : kind == 1 ? (hk < 0.45 ? 0.1 * hk : hk < 0.75 ? 0.45 + 0.3 * hk : 0.85 + 0.15 * hk)
          : kind == 3 ? 0.65 + 0.35 * hk
          : kind == 4 ? 0.8 + 0.2 * hk
          : 0.15 + 0.8 * hk;
  float kMean = kind == 0 ? 0.81 : kind == 1 ? 0.45 : kind == 3 ? 0.82 : kind == 4 ? 0.9 : 0.55;
  // Linear radiance before exposure: above 1 so the bloom picks up lit windows, shops brightest.
  float power = kind == 0 ? 2.4 : kind == 1 ? 1.7 : kind == 3 ? 3.6 : 2.0;
  facadeLamp = facadeLampColor(mix(k, kMean, facadeFar)) * power * mix(0.6 + 0.8 * hb, 1.0, facadeFar);
  // A few homes are lit only by a television: blue, cutting between shots a few times a second.
  bool isTv = kind == 1 && hc < 0.07 && facadeFar < 0.5;
  if (isTv) facadeLamp = vec3(0.42, 0.58, 1.0) * (0.35 + 0.55 * facadeHash(vec2(floor(uTime * 2.7 + hb * 50.0), hc * 113.0)));

  // Blinds and curtains lowered on some windows: they glow flat, without the room behind.
  float blindLine = 2.0;
  if (kind == 0 && hc > 0.7) blindLine = 0.45 + 0.5 * fract(hc * 7.0);
  if (kind == 1) blindLine = hc > 0.62 ? 0.0 : hc > 0.4 ? 0.35 + 0.5 * fract(hc * 11.0) : 2.0;
  if (kind == 2 && hc > 0.75) blindLine = 0.0;
  facadeClear *= 1.0 - step(blindLine, facadeCellUv.y);
  vec3 cloth = kind == 1 ? mix(vec3(1.0, 0.8, 0.58), vec3(0.95), step(0.85, hc)) : vec3(0.9);
  // Venetian slats 10 cm apart, smoothed out once they are smaller than a pixel.
  float slats = kind == 0 ? mix(0.75 + 0.25 * step(0.5, fract(cellF.y * 35.0)), 0.87, smoothstep(0.2, 0.6, fw.y * 35.0)) : 1.0;
  // Brighter towards the lamps at the top; drawn blinds keep their slats from the texture.
  float drawnSlats = mix(1.0, 0.55 + 0.6 * smoothstep(0.16, 0.5, luma), baked);
  facadeBlindGlow = facadeLamp * 0.5 * cloth * slats * drawnSlats * (0.65 + 0.5 * facadeCellUv.y);
  facadeGlow = mix(facadeBlindGlow, facadeLamp * 0.4, facadeClear);
#else
  facadeLit = step(0.6, facadeHash(cell + vec2(layer * 17.0, tint * 97.0)));
#endif

  vec3 roof = mix(vec3(0.46, 0.47, 0.48), vec3(0.58, 0.57, 0.55), tint);
  diffuseColor.rgb = facadeWall > 0.5 ? tex.rgb * (0.88 + 0.24 * tint) : roof;
  // Clear glass is dark by day (the room behind); its brightness comes from the reflection.
  diffuseColor.rgb *= 1.0 - 0.45 * facadeWindow * facadeClear;

  // Ground contact: less sky and bounce light near the street (≈2.5 m) and down the street
  // canyon, plus splash grime. Why not SSAO: it needs a depth pre-pass over the whole scene.
  float h = vFacade.y;
  facadeAO = facadeWall > 0.5 ? mix(0.35, 1.0, smoothstep(0.0, 2.6, h)) * mix(0.8, 1.0, smoothstep(0.0, 30.0, h)) : 1.0;
  diffuseColor.rgb *= facadeWall > 0.5 ? mix(0.82, 1.0, smoothstep(0.0, 1.0, h)) : 1.0;

  // Rain streaks: water runs off each sill in 25 cm columns for 0.5–2 m; faint stains when dry.
  float sillsUp = cellF.y - 0.19;
  float below = 1.0 - fract(sillsUp);
  float colF = along * 4.0;
  float hs = facadeHash(vec2(mod(floor(colF), ${(BAYS_PER_PERIOD * 4).toFixed(1)}), floor(sillsUp) + face * 13.0 + tint * 41.0));
  float streakLen = 0.15 + 0.45 * fract(hs * 7.31);
  float lane = smoothstep(0.15, 0.6, 1.0 - abs(fract(colF) * 2.0 - 1.0));
  facadeStreak = facadeWall * (1.0 - facadeWindow) * step(0.55, hs) * lane * clamp(1.0 - below / streakLen, 0.0, 1.0);
  // Wet: concrete, tile and brick darken (water fills the pores); metal panels much less.
  float porous = style == 6 ? 0.4 : 1.0;
  float wet = uWet * (1.0 - facadeWindow) * porous;
  diffuseColor.rgb *= 1.0 - wet * (0.32 + 0.25 * facadeStreak) - 0.08 * facadeStreak;
}
`;

// Wet walls are glossier; glass is smooth; curtain walls are coated (mirror-like, tinted).
const ROUGHNESS = /* glsl */ `
roughnessFactor = mix(roughnessFactor, 0.32, uWet * facadeWall * (0.55 + 0.45 * facadeStreak));
roughnessFactor = mix(roughnessFactor, facadeCurtainWall > 0.5 ? 0.04 : 0.07, facadeWindow);
`;
const METALNESS = /* glsl */ `
metalnessFactor = mix(metalnessFactor, 0.65, facadeWindow * facadeCurtainWall);
`;
// Curtain-wall panes are each tilted a little (as real ones are), which breaks the reflection up.
const NORMAL = /* glsl */ `
if (facadeWindow * facadeCurtainWall > 0.5) {
  vec2 tilt = vec2(facadeHash(facadePane + 0.37), facadeHash(facadePane + vec2(5.1, 2.9))) - 0.5;
  vec3 across = normalize((viewMatrix * vec4(facadeTangent, 0.0)).xyz);
  vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  normal = normalize(normal + 0.035 * (tilt.x * across + tilt.y * up));
}
`;
// Lit windows: the room behind near the camera, the flat glow further away, less what the glass
// reflects (Fresnel). Lights are on by day too, but only nearby rooms show against daylight.
const EMISSIVE = /* glsl */ `
{
#ifdef FACADE_WINDOWS_LIT
  float nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  float f0 = facadeCurtainWall > 0.5 ? 0.2 : 0.04;
  float fresnel = f0 + (1.0 - f0) * pow(1.0 - nv, 5.0);
  vec3 glow = facadeGlow;
  float near = 0.0;
#ifdef FACADE_INTERIOR
  vec3 eye = vFacadePos - cameraPosition;
  float dist = length(eye);
  near = (1.0 - smoothstep(70.0, 140.0, dist)) * (1.0 - facadeFar);
  bool isRoom = near > 0.0 && facadeLit > 0.0 && facadeWindow > 0.0 && facadeClear > 0.0;
  if (isRoom) {
    vec3 e = eye / dist;
    vec3 fn = normalize(vFacadeNormal);
    vec2 size = vec2(${(TILE_W / 4).toFixed(1)} * facadeRoomCells, facadeRoomDepth);
    vec3 d = vec3(dot(e, facadeTangent) / size.x, e.y / ${(TILE_H / 4).toFixed(1)}, max(-dot(e, fn), 0.05) / size.y);
    vec3 room = facadeInterior(vec2(facadeRoomX, facadeCellUv.y), d, facadeRoomSeed, facadeRoomKind, size) * facadeLamp;
    glow = mix(glow, mix(facadeBlindGlow, room, facadeClear), near);
  }
#endif
  float shown = uNight + (1.0 - uNight) * 0.08 * near;
  totalEmissiveRadiance += glow * facadeWindow * facadeLit * shown * (1.0 - fresnel);
#else
  totalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * facadeWindow * facadeLit * uNight * 1.2;
#endif
}
`;
// Ground contact darkens the sky and bounce light (not the sun).
const AO = /* glsl */ `
reflectedLight.indirectDiffuse *= facadeAO;
reflectedLight.indirectSpecular *= mix(1.0, facadeAO, 0.6);
`;

/** Live façade materials, recompiled when 夜の窓 changes (one shared program per setting). */
const materials = new Set<MeshStandardMaterial>();
let windowsSetting = GRAPHICS.settings.windows;
GRAPHICS.onChange((settings) => {
  const isSame = settings.windows === windowsSetting;
  if (isSame) return;
  windowsSetting = settings.windows;
  for (const material of materials) material.needsUpdate = true;
});

// WEBGPU-TODO(phase C): the façade in TSL (node materials ignore onBeforeCompile and the WebGL
// program cache key below): night windows by hour and use, interior mapping, glass, ground contact,
// wet walls, from the same `facade` attribute and facadeUniforms (uNight via Buildings.
// setNightFactor, uTime/uWet via setFacadeClock, uLitShare, uOrigin, uFacadeTex) and 画質 夜の窓.
// Until then the walls are the plain material: their colour, no windows lit at night.
export function applyFacade(material: MeshStandardMaterial): void {
  materials.add(material);
  material.addEventListener("dispose", () => materials.delete(material));
  // How: the setting is a define (no cost for what is off, e.g. on phones); the cache key keeps
  // one program per setting, so switching back is instant.
  material.customProgramCacheKey = () => `plateau-facade-${windowsSetting}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = facadeUniforms.uNight;
    shader.uniforms.uOrigin = facadeUniforms.uOrigin;
    shader.uniforms.uFacadeTex = facadeUniforms.uFacadeTex;
    shader.uniforms.uLitShare = facadeUniforms.uLitShare;
    shader.uniforms.uWet = facadeUniforms.uWet;
    shader.uniforms.uTime = facadeUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 facade;\nvarying vec2 vFacade;\nvarying vec3 vFacadePos;\nvarying vec3 vFacadeNormal;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvFacade = facade;\nvFacadePos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvFacadeNormal = normalize(mat3(modelMatrix) * objectNormal);",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${WINDOW_DEFINES[windowsSetting]}\n${PARS}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${COLOR}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${ROUGHNESS}`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n${METALNESS}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${NORMAL}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${EMISSIVE}`)
      .replace("#include <aomap_fragment>", `#include <aomap_fragment>\n${AO}`);
  };
  material.needsUpdate = true;
}
