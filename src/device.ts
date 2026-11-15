import { Graphics, loadGraphics, type GraphicsSettings } from "./graphics";

/**
 * Device profile. Phones (Android is the supported mobile target) start on the 低 preset, a lighter
 * renderer and a smaller world radius so a mid-range GPU keeps a playable frame rate.
 */
export type Quality = {
  isMobile: boolean;
  pixelRatio: number;
  antialias: boolean;
  /** The sun casts shadows (画質 影 not なし), with a map of shadowMapSize. */
  shadows: boolean;
  shadowMapSize: number;
  terrainRadius: number; // chunks around the player (z15 tile ≈ 990 m)
  maxImageryZoom: number;
  buildingLoadRadius: number; // metres
  /**
   * The near town's LRU limit: bytes as the LRU counts them (the tiles' geometry and textures as the
   * renderer sizes them). The page's memory for the same tiles is about 6 times that (array storage
   * ~4.4×, the JS heap ~1.6×; X0, 2026-11-15; why is not known yet).
   */
  buildingCacheBytes: number;
  /** The far ground (farGround.ts): GSI tile zoom, tiles on each side of the player's, grid cells per tile. */
  farGroundZoom: number;
  farGroundRing: number;
  farGroundSegments: number;
  /**
   * The far skyline (buildings.ts): PLATEAU tiles within this radius (m), none finer than this
   * geometric error (m), refined to the screen-space error target (px; 1e6: never by distance).
   */
  farBuildingRadius: number;
  farBuildingMinError: number;
  farBuildingErrorTarget: number;
  crowdScale: number;
  maxAiCars: number;
};

function detectMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isCoarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return isAndroid || isCoarse;
}

/** What the device is, and the 画質 settings it starts with (graphics.ts). */
const IS_MOBILE = detectMobile();
export const GRAPHICS = new Graphics(loadGraphics(IS_MOBILE));

const MIB = 1024 ** 2;
/**
 * The near town's LRU on a phone by default: the far skyline's phone limit (FAR_CACHE), which the
 * town shared and lived under from 2026-10-05 (the far skyline's arrival) until X0. Held until the
 * phones themselves are tried (U12): a phone's whole memory for the town of `full` was measured on a
 * PC's Chrome only (about 0.8-0.9 → 1.6-1.9 GB). The radius follows the 描画距離, as before.
 */
const PHONE_TOWN_CACHE = 24 * MIB;
/**
 * `?phoneTown=full` on a phone: the town X0 measured for phones, to be tried on the phones from the
 * published build. The cache is 2 × 130 MB used (2026-11-15, the warp loop at 池袋 on 低; the title's
 * pan 111 MB), in 32 MiB steps; the load radius is held at 低's whatever the 描画距離. Why not the
 * 描画距離's radius with a cache to match: on 最高 a phone's heap would then grow as a PC's (a lower
 * bound of 365 MiB); with the radius held, a phone's memory does not follow the setting.
 */
const PHONE_TOWN_FULL_CACHE = 256 * MIB;
/** Which town a phone streams: the default (null) or the one under trial ("full"). */
export type PhoneTown = "full" | null;

/** `?phoneTown=full` read as `?expressway` is; any other value is the default. */
function readPhoneTown(): PhoneTown {
  const hasLocation = typeof location !== "undefined";
  if (!hasLocation) return null;
  const isFull = new URLSearchParams(location.search).get("phoneTown") === "full";
  return isFull ? "full" : null;
}

/** The town under trial on this device (phones only; a PC ignores the parameter). */
export const PHONE_TOWN: PhoneTown = IS_MOBILE ? readPhoneTown() : null;

/**
 * 描画距離. Beyond the streamed world a far ground and skyline reach the horizon (knowledge/
 * far-skyline.md): 低 (near) a 3×3 of z10 tiles (≥ 31 km each way, 2 km cells) and each ward's
 * coarsest PLATEAU tile within 14 km (10–26 tiles, 1–3 MB); 中・高 a 5×5 of z11 tiles (≥ 31 km,
 * 500 m cells) and the two coarsest levels within 20 km (45–90 tiles, 6–12 MB); 最高 out to 26 km.
 */
export const VIEW: Record<
  GraphicsSettings["viewDistance"],
  Pick<
    Quality,
    | "terrainRadius"
    | "maxImageryZoom"
    | "buildingLoadRadius"
    | "buildingCacheBytes"
    | "farGroundZoom"
    | "farGroundRing"
    | "farGroundSegments"
    | "farBuildingRadius"
    | "farBuildingMinError"
    | "farBuildingErrorTarget"
  >
> = {
  near: {
    terrainRadius: 1,
    maxImageryZoom: 17,
    buildingLoadRadius: 1600,
    // 2026-11-15, X0: twice the most the town held as used (111 MB, the title's pan at 大泉学園;
    // the warp loop 東京駅→新宿→渋谷→池袋→上野 108 MB, the starts a–f 90 MB), in 32 MiB steps.
    buildingCacheBytes: 224 * MIB,
    farGroundZoom: 10,
    farGroundRing: 1,
    farGroundSegments: 16,
    farBuildingRadius: 14_000,
    farBuildingMinError: 200,
    farBuildingErrorTarget: 1e6,
  },
  medium: {
    terrainRadius: 2,
    maxImageryZoom: 18,
    buildingLoadRadius: 2800,
    // 2026-11-15, X0: 2 × 204 MB used (the title's pan; the warp loop 159 MB, the starts 114 MB).
    buildingCacheBytes: 416 * MIB,
    farGroundZoom: 11,
    farGroundRing: 2,
    farGroundSegments: 32,
    farBuildingRadius: 20_000,
    farBuildingMinError: 150,
    farBuildingErrorTarget: 40,
  },
  far: {
    terrainRadius: 3,
    maxImageryZoom: 18,
    buildingLoadRadius: 4000,
    // 2026-11-15, X0: 2 × 312 MB used, the most of every run so far (the warp loop at its 52nd hop,
    // 35.701, 139.707 between 新宿 and 池袋, on the 544 MiB build; the title's pan 284 MB, the starts
    // 157 MB at 大田区), in 32 MiB steps.
    buildingCacheBytes: 608 * MIB,
    farGroundZoom: 11,
    farGroundRing: 2,
    farGroundSegments: 32,
    farBuildingRadius: 26_000,
    farBuildingMinError: 150,
    farBuildingErrorTarget: 28,
  },
};
const TRAFFIC: Record<GraphicsSettings["traffic"], Pick<Quality, "crowdScale" | "maxAiCars">> = {
  few: { crowdScale: 0.5, maxAiCars: 10 },
  normal: { crowdScale: 1, maxAiCars: 22 },
  many: { crowdScale: 1.4, maxAiCars: 34 },
};

/** The pixel ratio for a 解像度 setting: the cap, never above the screen's own. */
export function pixelRatioFor(resolution: GraphicsSettings["resolution"]): number {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const cap = Number(resolution);
  return cap < 1 ? cap : Math.min(dpr, cap);
}

/** A phone's near town: the default cache with the 描画距離's radius, or `full`'s cache with 低's radius. */
function phoneTownQuality(phoneTown: PhoneTown): Pick<Quality, "buildingCacheBytes"> & Partial<Quality> {
  const isFull = phoneTown === "full";
  if (!isFull) return { buildingCacheBytes: PHONE_TOWN_CACHE };
  return { buildingCacheBytes: PHONE_TOWN_FULL_CACHE, buildingLoadRadius: VIEW.near.buildingLoadRadius };
}

/**
 * The renderer and the world's sizes from the 画質 settings. Phones (a mid-range GPU) keep their
 * own building cache whatever the settings say (and, with `?phoneTown=full`, 低's building load radius).
 */
export function detectQuality(
  g: GraphicsSettings = GRAPHICS.settings,
  isMobile = IS_MOBILE,
  phoneTown: PhoneTown = PHONE_TOWN,
): Quality {
  return {
    isMobile,
    pixelRatio: pixelRatioFor(g.resolution),
    antialias: g.antialias === "on",
    shadows: g.shadows !== "off",
    shadowMapSize: g.shadows === "off" ? 1024 : Number(g.shadows),
    ...VIEW[g.viewDistance],
    // The far skyline, the ground and the photos follow the 描画距離 on a phone too.
    ...(isMobile ? phoneTownQuality(phoneTown) : {}),
    ...TRAFFIC[g.traffic],
  };
}

export const QUALITY = detectQuality();
