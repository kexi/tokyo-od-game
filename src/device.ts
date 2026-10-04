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
  buildingCacheBytes: number;
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

const VIEW: Record<
  GraphicsSettings["viewDistance"],
  Pick<Quality, "terrainRadius" | "maxImageryZoom" | "buildingLoadRadius">
> = {
  near: { terrainRadius: 1, maxImageryZoom: 17, buildingLoadRadius: 1600 },
  medium: { terrainRadius: 2, maxImageryZoom: 18, buildingLoadRadius: 2800 },
  far: { terrainRadius: 3, maxImageryZoom: 18, buildingLoadRadius: 4000 },
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

/**
 * The renderer and the world's sizes from the 画質 settings. Phones (a mid-range GPU) keep the
 * small building cache whatever the settings say.
 */
export function detectQuality(g: GraphicsSettings = GRAPHICS.settings, isMobile = IS_MOBILE): Quality {
  return {
    isMobile,
    pixelRatio: pixelRatioFor(g.resolution),
    antialias: g.antialias === "on",
    shadows: g.shadows !== "off",
    shadowMapSize: g.shadows === "off" ? 1024 : Number(g.shadows),
    ...VIEW[g.viewDistance],
    buildingCacheBytes: (isMobile ? 0.35 : 0.8) * 1024 ** 3,
    ...TRAFFIC[g.traffic],
  };
}

export const QUALITY = detectQuality();
