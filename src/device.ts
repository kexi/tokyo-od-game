/**
 * Device profile. Phones (Android is the supported mobile target) get a lighter renderer and a
 * smaller world radius so a mid-range GPU keeps a playable frame rate.
 */
export type Quality = {
  isMobile: boolean;
  pixelRatio: number;
  antialias: boolean;
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

export function detectQuality(): Quality {
  const isMobile = detectMobile();
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return isMobile
    ? {
        isMobile,
        pixelRatio: Math.min(dpr, 1.25),
        antialias: false,
        shadowMapSize: 1024,
        terrainRadius: 1,
        maxImageryZoom: 17,
        buildingLoadRadius: 1600,
        buildingCacheBytes: 0.35 * 1024 ** 3,
        crowdScale: 0.5,
        maxAiCars: 10,
      }
    : {
        isMobile,
        pixelRatio: Math.min(dpr, 1.5),
        antialias: true,
        shadowMapSize: 2048,
        terrainRadius: 2,
        maxImageryZoom: 18,
        buildingLoadRadius: 2800,
        buildingCacheBytes: 0.8 * 1024 ** 3,
        crowdScale: 1,
        maxAiCars: 22,
      };
}

export const QUALITY = detectQuality();
