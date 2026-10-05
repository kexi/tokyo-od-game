import {
  BufferAttribute,
  DataArrayTexture,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
} from "three";
import {
  abs,
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  dot,
  exp,
  float,
  floor,
  Fn,
  fract,
  fwidth,
  If,
  int,
  length,
  materialMetalness,
  materialRoughness,
  max,
  min,
  mix,
  mod,
  modelViewMatrix,
  normalize,
  normalView,
  normalWorldGeometry,
  positionLocal,
  positionViewDirection,
  positionWorld,
  pow,
  property,
  renderGroup,
  select,
  smoothstep,
  step,
  texture,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  MeshStandardNodeMaterial,
  PhysicalLightingModel,
  type Node,
  type NodeBuilder,
  type TextureNode,
} from "three/webgpu";
import { GRAPHICS, QUALITY } from "../device";
import { geodeticToEcef } from "../geo/ellipsoid";
import type { LocalFrame } from "../geo/frame";
import { jstHour } from "../geo/sun";
import type { GraphicsSettings } from "../graphics";
import { byIndex, hash12 } from "../render/shaderMath";
import { gameClock, tokyoDate } from "./ruleTime";

/**
 * Textured façades for untextured PLATEAU LOD1 buildings. Eight wall styles drawn by
 * scripts/textures/building_textures.py (each tile = 12.8 m × 14 m: four 3.2 m bays × four
 * 3.5 m storeys) are packed into one texture array, colour in RGB and the window mask in A.
 * Each building gets a style chosen from its height and floors counted from its own base
 * (vertex attribute `facade`, computed when a tile loads).
 *
 * All in the one façade material (a MeshStandardNodeMaterial built in TSL; no extra draw calls or
 * geometry): windows lit by the hour and the building's use, each with its own lamp colour, blind
 * or curtain; a fake room behind each lit window near the camera (interior mapping, not on
 * phones); glass that reflects the sky; walls darker where they meet the street; and wet walls
 * with rain streaks.
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

/**
 * What the façade shader reads, set from the CPU (`value`). The scalars are TSL uniforms in the
 * shared render group: one upload per render reaches every façade material.
 */
export const facadeUniforms = {
  uNight: uniform(0).setGroup(renderGroup),
  uOrigin: uniform(new Vector3()).setGroup(renderGroup),
  uFacadeTex: { value: null as DataArrayTexture | null },
  /** Lit share per style (STYLES order), then for street-level shops. */
  uLitShare: { value: Array.from({ length: STYLES.length + 1 }, () => 0) },
  uWet: uniform(0).setGroup(renderGroup),
  /** Seconds, for the television flicker. */
  uTime: uniform(0).setGroup(renderGroup),
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
  if (facadeTexNode) facadeTexNode.value = tex;
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
    const choices = (BY_HEIGHT.find(([limit]) => tall <= limit) ?? BY_HEIGHT[BY_HEIGHT.length - 1])[1];
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

// ---------- the façade in TSL ----------

/**
 * 画質 › 夜の窓: flat = the original single colour on a fixed 40 % of windows, lit = per-window
 * hours, colours and blinds, rooms = lit plus interior mapping near the camera. Each is its own node
 * graph (nothing of what is off is compiled, e.g. on phones), shared by every façade material.
 */
type WindowsMode = GraphicsSettings["windows"];

const aFacade = attribute<"vec2">("facade", "vec2");
const litShareNode = uniformArray<"float">(facadeUniforms.uLitShare.value, "float").setGroup(renderGroup);
let facadeTexNode: TextureNode | null = null;

/** The texture array node, made on first use (after loadFacadeTextures, which main.ts awaits). */
function facadeTexture(): TextureNode {
  facadeTexNode ??= texture(facadeUniforms.uFacadeTex.value ?? placeholderTexture());
  return facadeTexNode;
}

/** One texel per layer, with the real array's sampler, for a façade drawn before the textures load. */
function placeholderTexture(): DataArrayTexture {
  const tex = new DataArrayTexture(new Uint8Array(4 * STYLES.length).fill(160), 1, 1, STYLES.length);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// What the colour stage works out about this fragment and the later stages (roughness, normal,
// emissive, ambient occlusion) read: shader-wide variables, assigned once per fragment.
const fWall = property("float", "facadeWall");
const fWindow = property("float", "facadeWindow");
const fLit = property("float", "facadeLit"); // 0/1 near, the building's lit share where windows are sub-pixel
const fClear = property("float", "facadeClear"); // 1 = clear glass, 0 = blind or curtain behind it
const fCurtain = property("float", "facadeCurtainWall");
const fStreak = property("float", "facadeStreak");
const fAO = property("float", "facadeAO");
const fFar = property("float", "facadeFar");
const fRoomX = property("float", "facadeRoomX");
const fRoomCells = property("float", "facadeRoomCells");
const fRoomDepth = property("float", "facadeRoomDepth");
const fRoomKind = property("float", "facadeRoomKind"); // 1 = office or shop (ceiling panels, desks), 0 = home
const fCellUv = property("vec2", "facadeCellUv");
const fPane = property("vec2", "facadePane");
const fTangent = property("vec3", "facadeTangent");
const fLamp = property("vec3", "facadeLamp");
const fBlindGlow = property("vec3", "facadeBlindGlow");
const fGlow = property("vec3", "facadeGlow");
const fRoomSeed = property("vec4", "facadeRoomSeed");

// Use behind each style (office 0, home 1, mixed 2, shop 3, works 4) and how much its windows go by floor.
const USE_INDEX = USE_OF_STYLE.map((u) => USES.indexOf(u));
const CORRELATION = USES.map((u) => FLOOR_CORRELATION[u]);
const SHOP = USES.indexOf("shop");

/**
 * Lamp colour by colour temperature, k: 0 = 2700 K, .25 = 3500 K, .5 = 4000 K, .75 = 5000 K,
 * 1 = 6500 K. Blackbody in linear sRGB, white-balanced a third of the way to 4000 K (as the eye
 * or a camera at night sees it, so 電球色 reads amber, not orange).
 */
function lampColour(k: Node<"float">): Node<"vec3"> {
  const s = k.mul(4);
  let c = mix(vec3(1.0, 0.49, 0.14), vec3(1.0, 0.668, 0.365), clamp(s, 0, 1));
  c = mix(c, vec3(1.0, 0.763, 0.532), clamp(s.sub(1), 0, 1));
  c = mix(c, vec3(1.0, 0.92, 0.885), clamp(s.sub(2), 0, 1));
  return mix(c, vec3(0.72, 0.78, 1.0), clamp(s.sub(3), 0, 1));
}

/**
 * Interior mapping (van Dongen 2008): the eye ray carries on behind the glass into a box room
 * (room width × 3.5 m × depth) and takes the colour of the back wall, side wall, ceiling or floor
 * it reaches first, unless a furniture card standing part-way in is in front. p: entry point
 * (0..1 across and up), d: ray direction in room units (z into the room), size: width and depth
 * in metres. Returns radiance relative to the lamp.
 * How: every face is shaded and the hit one selected (no branches: the caller already skips
 * windows without a room, and WGSL keeps it straight-line code).
 */
function interior(
  p: Node<"vec2">,
  ray: Node<"vec3">,
  seed: Node<"vec4">,
  isOffice: Node<"float">,
  size: Node<"vec2">,
): Node<"vec3"> {
  const nudge = mix(vec2(-1e-4, -1e-4), vec2(1e-4, 1e-4), step(vec2(0, 0), ray.xy));
  const d = vec3(ray.xy.add(nudge), ray.z);
  const o = vec3(p, 0);
  const t3 = step(vec3(0, 0, 0), d)
    .sub(o)
    .div(d);
  const t = min(min(t3.x, t3.y), t3.z);
  const h = o.add(d.mul(t));
  const wallColour = mix(vec3(0.55, 0.52, 0.47), vec3(0.82, 0.81, 0.78), seed.x);
  const isOfficeRoom = isOffice.greaterThan(0.5);
  // Lit from the ceiling: the back wall brightest at the top, the side walls in shade, the floor
  // dim, the ceiling dark between its lamps (they shine down).
  const back = wallColour.mul(h.y.mul(h.y).mul(0.6).add(0.22));
  const side = wallColour.mul(h.y.mul(0.32).add(0.1)).mul(h.z.mul(0.5).oneMinus());
  // Rows of light panels in offices, one round light in a home, each with a soft halo.
  const m = h.xz.mul(size);
  const officeCell = abs(fract(m.div(vec2(1.8, 2.4))).sub(0.5)).mul(vec2(1.8, 2.4));
  const cellM = select(isOfficeRoom, officeCell, abs(m.sub(size.mul(vec2(0.5, 0.45)))));
  const r = select(isOfficeRoom, max(cellM.x.sub(0.3), cellM.y.sub(0.55)), length(cellM).sub(0.28));
  const panel = step(0, r).oneMinus();
  const ceiling = vec3(0.1, 0.1, 0.1)
    .add(vec3(0.35, 0.35, 0.35).mul(exp(max(r, 0).mul(-3))))
    .add(vec3(3.2, 3.2, 3.2).mul(panel));
  // Floor: wood in homes, grey carpet in offices, a pool of light under the lamp.
  const wood = mix(vec3(0.42, 0.28, 0.16), vec3(0.55, 0.5, 0.42), seed.y);
  const floorColour = select(isOfficeRoom, vec3(0.3, 0.31, 0.33), wood);
  const floorLit = floorColour.mul(float(0.45).sub(length(h.xz.sub(vec2(0.5, 0.45))).mul(0.35)));
  const room = select(
    t.equal(t3.z),
    back,
    select(t.equal(t3.x), side, select(d.y.greaterThan(0), ceiling, floorLit)),
  );
  // Furniture: desks with monitors in an office, a sofa back in a home, seen against the room.
  const tc = seed.z.mul(0.35).add(0.3).div(d.z);
  const q = p.add(d.xy.mul(tc));
  const top = select(isOfficeRoom, float(0.215), seed.w.mul(0.08).add(0.24));
  const x0 = select(isOfficeRoom, float(0.04), seed.w.mul(0.3).add(0.1));
  const x1 = select(isOfficeRoom, float(0.96), x0.add(0.3).add(seed.y.mul(0.3)));
  const isAcross = step(x0, q.x).mul(step(q.x, x1));
  const isMonitor = isOffice
    .mul(step(abs(fract(q.x.mul(size.x).div(1.6)).sub(0.5)), 0.15))
    .mul(step(q.y, top.add(0.13)));
  const isBody = isAcross.mul(max(step(q.y, top), isMonitor));
  const body = vec3(0.05, 0.048, 0.045).add(
    wallColour
      .mul(0.35)
      .mul(smoothstep(top.sub(0.03), top, q.y))
      .mul(isMonitor.mul(step(top, q.y)).oneMinus()),
  );
  const seen = select(tc.lessThan(t).and(isBody.greaterThan(0.5)), body, room);
  return seen.mul(h.z.mul(0.55).oneMinus());
}

/**
 * Wall colour, which window this is and how it is lit, ground contact and rain: the colour stage,
 * which also fills the façade variables for the later stages.
 */
function surface(isLit: boolean): Node<"vec4"> {
  return Fn((builder: NodeBuilder) => {
    const shadowMaterial = builder.material as typeof builder.material & { isShadowPassMaterial?: boolean };
    const isShadowPass = shadowMaterial.isShadowPassMaterial === true;
    // Façade alpha is always one. Building its colour graph just to read alpha in a shadow
    // also builds window lighting and derivatives that opaque shadow depth never needs.
    if (isShadowPass) return vec4(0, 0, 0, 1);
    const fp = positionWorld.add(facadeUniforms.uOrigin).toVar();
    const fn = normalWorldGeometry;
    fWall.assign(step(0.6, abs(fn.y)).oneMinus());
    const layer = floor(aFacade.x).toVar();
    const tint = fract(aFacade.x).toVar();
    const isAlongZ = abs(fn.x).greaterThan(abs(fn.z));
    // Along the wall: world x or z (whichever the wall runs along); up: height above the base.
    const along = select(isAlongZ, fp.z, fp.x).toVar();
    fTangent.assign(select(isAlongZ, vec3(0, 0, 1), vec3(1, 0, 0)));
    const uv = vec2(along.div(TILE_W), aFacade.y.div(TILE_H));
    const tex = facadeTexture().sample(uv).depth(layer).toVar();
    fWindow.assign(fWall.mul(smoothstep(0.4, 0.6, tex.a)));
    fCurtain.assign(select(layer.lessThan(0.5), float(1), float(0)));
    // One window per bay and storey: 4 × 4 per tile. Ids wrap with PERIOD (see the top of the file).
    const cellF = uv.mul(4).toVar();
    const cell = floor(cellF).toVar();
    fCellUv.assign(cellF.sub(cell));
    fPane.assign(floor(cellF.mul(vec2(4, 1))));
    const face = select(
      isAlongZ,
      select(fn.x.greaterThan(0), float(1), float(2)),
      select(fn.z.greaterThan(0), float(3), float(4)),
    ).toVar();
    // Blinds and curtains drawn in the texture (light-coloured; not on curtain walls, whose light
    // panes are reflections): glass by day, a flat glow at night.
    const luma = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722)).toVar();
    const baked = select(fCurtain.greaterThan(0.5), float(0), smoothstep(0.16, 0.34, luma)).toVar();
    fClear.assign(baked.oneMinus());
    if (isLit) {
      // Where a window is under a pixel, its average instead (no sparkling of distant towers).
      // How: the derivative is taken here, in uniform control flow (WGSL requires it).
      const fw = fwidth(cellF).toVar();
      const wid = vec2(
        mod(cell.x, BAYS_PER_PERIOD).add(face.mul(211)),
        cell.y.add(tint.mul(977)).add(layer.mul(17)),
      );
      const building = hash12(vec2(tint.mul(531), layer.add(7))).toVar();
      // Street-level shops under offices and 雑居ビル, and under some blocks of flats (下駄履き).
      const isShop = cell.y.lessThan(0.5).and(
        layer
          .lessThan(2.5)
          .or(layer.equal(S.mixed_use))
          .or(layer.equal(S.apartment_balcony).and(building.lessThan(0.4))),
      );
      const kind = select(isShop, float(SHOP), byIndex(layer, USE_INDEX)).toVar();
      const isKind = (use: WindowUse) => kind.equal(USES.indexOf(use));
      // Busier and quieter buildings around the hour's share; a tenant lights a whole floor at once.
      const shareIndex = select(isShop, float(STYLES.length), layer);
      const share = clamp(litShareNode.element(int(shareIndex)).mul(building.add(0.45)), 0, 0.97);
      const isFloorWide = hash12(wid.add(vec2(41.7, 5.3))).lessThan(byIndex(kind, CORRELATION));
      const pick = select(isFloorWide, hash12(vec2(cell.y.add(0.5), tint.mul(313).add(face))), hash12(wid));
      fFar.assign(smoothstep(0.25, 0.8, max(fw.x, fw.y)));
      fLit.assign(mix(step(pick, share), share, fFar));

      // The room behind: open-plan offices span the tile, shops two bays, homes one.
      fRoomKind.assign(byIndex(kind, [1, 0, 0, 1, 0]));
      fRoomCells.assign(byIndex(kind, [4, 1, 1, 2, 1]));
      fRoomDepth.assign(
        select(
          isKind("office"),
          building.mul(4).add(9),
          select(isKind("shop"), float(8), building.mul(2).add(4.5)),
        ),
      );
      const roomF = cellF.x.div(fRoomCells).toVar();
      fRoomX.assign(fract(roomF));
      const rid = vec2(mod(floor(roomF), BAYS_PER_PERIOD).add(face.mul(211)), wid.y);
      fRoomSeed.assign(
        vec4(
          hash12(rid.add(vec2(13.1, 3.7))),
          hash12(rid.add(vec2(27.3, 9.1))),
          hash12(wid.add(vec2(7.9, 21.5))),
          hash12(rid.add(vec2(3.3, 17.7))),
        ),
      );
      const hk = fRoomSeed.x;
      const hb = fRoomSeed.y;
      const hc = fRoomSeed.z;
      // Colour temperature: offices 4500–6500 K; homes mix 電球色 (2700 K) with 昼白色/昼光色 ceiling
      // lights; shops bright white; 雑居ビル anything. Far away, the use's average.
      const homeK = select(
        hk.lessThan(0.45),
        hk.mul(0.1),
        select(hk.lessThan(0.75), hk.mul(0.3).add(0.45), hk.mul(0.15).add(0.85)),
      );
      const k = select(
        isKind("office"),
        hk.mul(0.38).add(0.62),
        select(
          isKind("home"),
          homeK,
          select(
            isKind("shop"),
            hk.mul(0.35).add(0.65),
            select(isKind("works"), hk.mul(0.2).add(0.8), hk.mul(0.8).add(0.15)),
          ),
        ),
      );
      const kMean = byIndex(kind, [0.81, 0.45, 0.55, 0.82, 0.9]);
      // Linear radiance before exposure: above 1 so the bloom picks up lit windows, shops brightest.
      const power = byIndex(kind, [2.4, 1.7, 2.0, 3.6, 2.0]);
      const lamp = lampColour(mix(k, kMean, fFar))
        .mul(power)
        .mul(mix(hb.mul(0.8).add(0.6), 1, fFar));
      // A few homes are lit only by a television: blue, cutting between shots a few times a second.
      const isTv = isKind("home").and(hc.lessThan(0.07)).and(fFar.lessThan(0.5));
      const tvCut = hash12(vec2(floor(facadeUniforms.uTime.mul(2.7).add(hb.mul(50))), hc.mul(113)));
      fLamp.assign(select(isTv, vec3(0.42, 0.58, 1.0).mul(tvCut.mul(0.55).add(0.35)), lamp));

      // Blinds and curtains lowered on some windows: they glow flat, without the room behind.
      const officeBlind = select(hc.greaterThan(0.7), fract(hc.mul(7)).mul(0.5).add(0.45), float(2));
      const homeBlind = select(
        hc.greaterThan(0.62),
        float(0),
        select(hc.greaterThan(0.4), fract(hc.mul(11)).mul(0.5).add(0.35), float(2)),
      );
      const mixedBlind = select(hc.greaterThan(0.75), float(0), float(2));
      const blindLine = select(
        isKind("office"),
        officeBlind,
        select(isKind("home"), homeBlind, select(isKind("mixed"), mixedBlind, float(2))),
      );
      fClear.mulAssign(step(blindLine, fCellUv.y).oneMinus());
      const cloth = select(
        isKind("home"),
        mix(vec3(1.0, 0.8, 0.58), vec3(0.95, 0.95, 0.95), step(0.85, hc)),
        vec3(0.9, 0.9, 0.9),
      );
      // Venetian slats 10 cm apart, smoothed out once they are smaller than a pixel.
      const slatLines = step(0.5, fract(cellF.y.mul(35)))
        .mul(0.25)
        .add(0.75);
      const slats = select(
        isKind("office"),
        mix(slatLines, 0.87, smoothstep(0.2, 0.6, fw.y.mul(35))),
        float(1),
      );
      // Brighter towards the lamps at the top; drawn blinds keep their slats from the texture.
      const drawnSlats = mix(float(1), smoothstep(0.16, 0.5, luma).mul(0.6).add(0.55), baked);
      fBlindGlow.assign(
        fLamp.mul(0.5).mul(cloth).mul(slats).mul(drawnSlats).mul(fCellUv.y.mul(0.5).add(0.65)),
      );
      fGlow.assign(mix(fBlindGlow, fLamp.mul(0.4), fClear));
    } else {
      fLit.assign(step(0.6, hash12(cell.add(vec2(layer.mul(17), tint.mul(97))))));
    }

    const roof = mix(vec3(0.46, 0.47, 0.48), vec3(0.58, 0.57, 0.55), tint);
    const isWall = fWall.greaterThan(0.5);
    const colour = select(isWall, tex.rgb.mul(tint.mul(0.24).add(0.88)), roof).toVar();
    // Clear glass is dark by day (the room behind); its brightness comes from the reflection.
    colour.mulAssign(fWindow.mul(fClear).mul(0.45).oneMinus());

    // Ground contact: less sky and bounce light near the street (≈2.5 m) and down the street
    // canyon, plus splash grime. Why not SSAO: it needs a depth pre-pass over the whole scene.
    const h = aFacade.y;
    const contact = mix(0.35, 1, smoothstep(0, 2.6, h)).mul(mix(0.8, 1, smoothstep(0, 30, h)));
    fAO.assign(select(isWall, contact, float(1)));
    colour.mulAssign(select(isWall, mix(0.82, 1, smoothstep(0, 1, h)), float(1)));

    // Rain streaks: water runs off each sill in 25 cm columns for 0.5–2 m; faint stains when dry.
    const sillsUp = cellF.y.sub(0.19);
    const below = fract(sillsUp).oneMinus();
    const colF = along.mul(4);
    const hs = hash12(
      vec2(mod(floor(colF), BAYS_PER_PERIOD * 4), floor(sillsUp).add(face.mul(13)).add(tint.mul(41))),
    ).toVar();
    const streakLen = fract(hs.mul(7.31)).mul(0.45).add(0.15);
    const lane = smoothstep(0.15, 0.6, abs(fract(colF).mul(2).sub(1)).oneMinus());
    fStreak.assign(
      fWall
        .mul(fWindow.oneMinus())
        .mul(step(0.55, hs))
        .mul(lane)
        .mul(clamp(below.div(streakLen).oneMinus(), 0, 1)),
    );
    // Wet: concrete, tile and brick darken (water fills the pores); metal panels much less.
    const porous = select(layer.equal(S.metal_panel), float(0.4), float(1));
    const wet = facadeUniforms.uWet.mul(fWindow.oneMinus()).mul(porous);
    colour.mulAssign(
      float(1)
        .sub(wet.mul(fStreak.mul(0.25).add(0.32)))
        .sub(fStreak.mul(0.08)),
    );
    return vec4(colour, 1);
  })();
}

// Wet walls are glossier; glass is smooth; curtain walls are coated (mirror-like, tinted).
const facadeRoughness = mix(
  mix(materialRoughness, 0.32, facadeUniforms.uWet.mul(fWall).mul(fStreak.mul(0.45).add(0.55))),
  select(fCurtain.greaterThan(0.5), float(0.04), float(0.07)),
  fWindow,
);
const facadeMetalness = mix(materialMetalness, 0.65, fWindow.mul(fCurtain));

/**
 * Curtain-wall panes are each tilted a little (as real ones are), which breaks the reflection up.
 * Read in the normal stage, where normalView is the geometry's normal (in view space).
 */
const facadeNormal = Fn(() => {
  const isPane = fWindow.mul(fCurtain).greaterThan(0.5);
  const tilt = vec2(hash12(fPane.add(0.37)), hash12(fPane.add(vec2(5.1, 2.9)))).sub(0.5);
  const across = normalize(cameraViewMatrix.mul(vec4(fTangent, 0)).xyz);
  const up = normalize(cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz);
  const tilted = normalize(normalView.add(across.mul(tilt.x).add(up.mul(tilt.y)).mul(0.035)));
  return select(isPane, tilted, normalView);
})();

/**
 * Lit windows: the room behind near the camera, the flat glow further away, less what the glass
 * reflects (Fresnel). Lights are on by day too, but only nearby rooms show against daylight.
 */
function emission(mode: WindowsMode): Node<"vec3"> {
  const night = facadeUniforms.uNight;
  if (mode === "flat") return vec3(1.0, 0.78, 0.45).mul(fWindow).mul(fLit).mul(night).mul(1.2);
  return Fn(() => {
    const nv = clamp(dot(normalView, positionViewDirection), 0, 1);
    const f0 = select(fCurtain.greaterThan(0.5), float(0.2), float(0.04));
    const fresnel = f0.add(f0.oneMinus().mul(pow(nv.oneMinus(), 5)));
    const glow = fGlow.toVar();
    let near: Node<"float"> = float(0);
    if (mode === "rooms") {
      const eye = positionWorld.sub(cameraPosition).toVar();
      const dist = length(eye).toVar();
      const nearby = smoothstep(70, 140, dist).oneMinus().mul(fFar.oneMinus()).toVar();
      near = nearby;
      const isRoom = nearby
        .greaterThan(0)
        .and(fLit.greaterThan(0))
        .and(fWindow.greaterThan(0))
        .and(fClear.greaterThan(0));
      // How: a real branch, so windows without a room skip the box; nothing in it takes derivatives.
      If(isRoom, () => {
        const e = eye.div(dist);
        const size = vec2(fRoomCells.mul(TILE_W / 4), fRoomDepth);
        const ray = vec3(
          dot(e, fTangent).div(size.x),
          e.y.div(TILE_H / 4),
          max(dot(e, normalWorldGeometry).negate(), 0.05).div(size.y),
        );
        const room = interior(vec2(fRoomX, fCellUv.y), ray, fRoomSeed, fRoomKind, size).mul(fLamp);
        glow.assign(mix(glow, mix(fBlindGlow, room, fClear), nearby));
      });
    }
    const shown = night.add(night.oneMinus().mul(0.08).mul(near));
    return glow.mul(fWindow).mul(fLit).mul(shown).mul(fresnel.oneMinus());
  })();
}

type FacadeNodes = Pick<
  MeshStandardNodeMaterial,
  "colorNode" | "roughnessNode" | "metalnessNode" | "normalNode" | "emissiveNode"
>;
const graphs = new Map<WindowsMode, FacadeNodes>();

/** The node graph for a 夜の窓 setting, built once and shared by every façade material. */
function facadeNodes(mode: WindowsMode): FacadeNodes {
  let nodes = graphs.get(mode);
  if (nodes) return nodes;
  nodes = {
    colorNode: surface(mode !== "flat"),
    roughnessNode: facadeRoughness,
    metalnessNode: facadeMetalness,
    normalNode: facadeNormal,
    emissiveNode: emission(mode),
  };
  graphs.set(mode, nodes);
  return nodes;
}

/** Ground contact darkens the sky and bounce light (not the sun). */
class FacadeLightingModel extends PhysicalLightingModel {
  override ambientOcclusion(builder: NodeBuilder): void {
    super.ambientOcclusion(builder);
    const light = (builder.context as { reflectedLight: ReflectedLight }).reflectedLight;
    light.indirectDiffuse.mulAssign(fAO);
    light.indirectSpecular.mulAssign(mix(1, fAO, 0.6));
  }
}
type ReflectedLight = Record<"indirectDiffuse" | "indirectSpecular", Node<"vec3">>;

/** A PLATEAU wall: the façade nodes for the current 夜の窓 and the ground-contact lighting. */
class FacadeMaterial extends MeshStandardNodeMaterial {
  windows: WindowsMode;

  constructor(windows: WindowsMode) {
    super({ color: 0xffffff, roughness: 0.85, metalness: 0.05 });
    this.windows = windows;
    Object.assign(this, facadeNodes(windows));
  }

  /** Switches the node graph (rebuilt on the next draw; one shared pipeline per setting). */
  setWindows(windows: WindowsMode): void {
    const isSame = windows === this.windows;
    if (isSame) return;
    this.windows = windows;
    Object.assign(this, facadeNodes(windows));
    this.needsUpdate = true;
  }

  override setupLightingModel(): PhysicalLightingModel {
    return new FacadeLightingModel();
  }

  override customProgramCacheKey(): string {
    return `${super.customProgramCacheKey()}:plateau-facade-${this.windows}`;
  }
}

/** Live façade materials, switched when 夜の窓 changes. */
const materials = new Set<FacadeMaterial>();
GRAPHICS.onChange((settings) => {
  for (const material of materials) material.setWindows(settings.windows);
});

/** A new façade material for a PLATEAU tile mesh (one per mesh; they share their pipelines). */
export function facadeMaterial(): MeshStandardNodeMaterial {
  const material = new FacadeMaterial(GRAPHICS.settings.windows);
  materials.add(material);
  material.addEventListener("dispose", () => materials.delete(material));
  return material;
}

// ---------- the far skyline's façade ----------

/**
 * How much deeper (as a share of the distance) the far skyline draws than it is: a building the
 * streamed tiles also hold is the same triangles in both, and the near copy, with its windows and
 * rooms, must win the depth test. Along the eye's ray, so nothing moves on the screen: 0.1 % is
 * 1 m at 1 km and 10 m at 10 km, far less than the gaps between towers.
 */
export const FAR_DEPTH_PUSH = 1.001;
/** Metres per storey on the far skyline (the façade's 3.5 m storeys). */
const FAR_STOREY = TILE_H / 4;

let farMaterial: MeshStandardNodeMaterial | null = null;

/**
 * The façade's simplified form for the far skyline (buildings.ts, PLATEAU's coarse tiles beyond the
 * streamed ones): no texture lookups per window, no rooms, no rain. Each wall takes its style's
 * average colour and window share from the last mip of the façade textures; at night each storey is
 * lit or not by the hour's share for the style's use (litShare, the same table and per-building
 * spread as near), averaged once storeys are under a pixel. One material for every far tile.
 */
export function farFacadeMaterial(): MeshStandardNodeMaterial {
  if (farMaterial) return farMaterial;
  const m = new MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0.05 });
  m.name = "far-facade";
  const layer = floor(aFacade.x);
  const tint = fract(aFacade.x);
  const isWall = step(0.6, abs(normalWorldGeometry.y)).oneMinus();
  // How: the smallest mip of the style's tile is its average (colour, and the window mask in A).
  const mean = facadeTexture().sample(vec2(0.5, 0.5)).level(float(12)).depth(layer);
  const roof = mix(vec3(0.46, 0.47, 0.48), vec3(0.58, 0.57, 0.55), tint);
  m.colorNode = mix(roof, mean.rgb.mul(tint.mul(0.24).add(0.88)), isWall);
  const storey = aFacade.y.div(FAR_STOREY);
  const building = hash12(vec2(tint.mul(531), layer.add(7)));
  const share = clamp(litShareNode.element(int(layer)).mul(building.add(0.45)), 0, 0.97);
  const pick = hash12(vec2(floor(storey).add(0.5), tint.mul(313)));
  // Storeys under a pixel: the share itself (no sparkle on towers 10 km off).
  const isFar = smoothstep(0.3, 0.8, fwidth(storey));
  const lit = mix(step(pick, share), share, isFar);
  const kind = byIndex(layer, USE_INDEX);
  const lamp = lampColour(byIndex(kind, [0.81, 0.45, 0.55, 0.82, 0.9])).mul(
    byIndex(kind, [2.4, 1.7, 2.0, 3.6, 2.0]),
  );
  // As the near façade's far glow: 0.4 of the lamp through clear glass, on the window share.
  m.emissiveNode = lamp.mul(0.4).mul(mean.a).mul(lit).mul(isWall).mul(facadeUniforms.uNight);
  m.vertexNode = cameraProjectionMatrix.mul(
    vec4(modelViewMatrix.mul(vec4(positionLocal, 1)).xyz.mul(FAR_DEPTH_PUSH), 1),
  );
  farMaterial = m;
  return m;
}
