// Static endpoints and tuning constants. All remote endpoints here were verified to send
// `Access-Control-Allow-Origin: *`, which is what lets the game run on static GitHub Pages.
import type { PlateauSource } from "./world/plateauRoot";

const PLATEAU_LOD1 = (code: string) =>
  `https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/${code}-bldg-lod1-latest/tileset.json`;

/**
 * The prefectures whose PLATEAU LOD1 buildings the game streams, each with its box (degrees, a
 * margin included): only the outer frame its tileset stays within (`just check-plateau-root`
 * checks every municipality's region against it). What decides whether a gated prefecture loads is
 * its gate, the regions of its municipalities (src/world/plateauRoot.ts): a box is not the
 * prefecture's shape, and Kanagawa's north edge (35.672, set by 相模原) is 1.0 km south of Tokyo
 * Station. Tokyo is not gated, and its box reaches the islands (大島 … 小笠原, 136.07–153.99°E,
 * 20.42–35.90°N on 2026-11-15) because its tileset holds them. Why not one renderer per
 * prefecture: their LRUs would add up at a border (up to four times the memory) and the
 * load-model, cut-out and collider wiring would be four times over.
 */
export const PLATEAU_SOURCES: readonly PlateauSource[] = [
  {
    code: "13",
    name: "東京都",
    url: PLATEAU_LOD1("13"),
    box: { west: 136.0, south: 20.4, east: 154.0, north: 35.95 },
    gated: false,
  },
  {
    code: "14",
    name: "神奈川県",
    url: PLATEAU_LOD1("14"),
    box: { west: 138.9, south: 35.1, east: 139.85, north: 35.7 },
    gated: true,
  },
  {
    code: "11",
    name: "埼玉県",
    url: PLATEAU_LOD1("11"),
    box: { west: 138.7, south: 35.74, east: 139.95, north: 36.3 },
    gated: true,
  },
  {
    code: "12",
    name: "千葉県",
    url: PLATEAU_LOD1("12"),
    box: { west: 139.7, south: 34.85, east: 140.9, north: 36.15 },
    gated: true,
  },
];

/**
 * PLATEAU LOD1, through the root that joins PLATEAU_SOURCES (public/data/plateau/tileset.json,
 * `just make-plateau-root`). LOD2 was tried and dropped: it exists for fewer municipalities
 * (45 vs 62 sub-tilesets in Tokyo), its textured tiles exhaust a 1.6 GB cache within ~1 km, and
 * its intermediate levels contain decimated wall fragments that float in the air. Why not list the
 * municipalities' tileset.json in the root: their URLs change with each `-latest` update; only the
 * prefectures' are stable. Optional chaining: a tsx script (scripts/plateauRoot.ts) has no
 * import.meta.env.
 */
export const PLATEAU_TILESET = `${(import.meta.env as ImportMetaEnv | undefined)?.BASE_URL ?? "/"}data/plateau/tileset.json`;

export const GSI = {
  dem5a: (z: number, x: number, y: number) =>
    `https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/${z}/${x}/${y}.png`,
  dem5aText: (z: number, x: number, y: number) =>
    `https://cyberjapandata.gsi.go.jp/xyz/dem5a/${z}/${x}/${y}.txt`,
  dem10: (z: number, x: number, y: number) =>
    `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${z}/${x}/${y}.png`,
  photo: (z: number, x: number, y: number) =>
    `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${z}/${x}/${y}.jpg`,
} as const;
/** PLATEAU orthophoto (2023, ~30 cm). Optional ground style; same PDL1.0 terms as the 3D model. */
export const PLATEAU_ORTHO = (z: number, x: number, y: number) =>
  `https://tile.plateauview.mlit.go.jp/tiles/plateau-ortho-2023/${z}/${x}/${y}.png`;

// GSI 標準地図 (std) is deliberately not offered: draping a basic survey map on a DEM-derived
// 3D surface is a case GSI's Q&A (Q2-4) lists as possibly requiring survey-act approval.
export type GroundStyle = "photo" | "plateau";

export const ODPT = {
  toeiBus: "https://api-public.odpt.org/api/v4/odpt:Bus?odpt:operator=odpt.Operator:Toei",
} as const;

export const JMA = {
  latestTime: "https://www.jma.go.jp/bosai/amedas/data/latest_time.txt",
  map: (stamp: string) => `https://www.jma.go.jp/bosai/amedas/data/map/${stamp}.json`,
  tokyoStation: "44132",
  // Tokyo (Kitanomaru) does not measure visibility; Yokohama and Chiba, ~30 km either side, do.
  visibilityStations: ["46106", "45212"],
} as const;

/**
 * 行幸通り between the Imperial Palace and Tokyo Station: flat, wide and iconic.
 * (Nishi-Shinjuku was tried first but its two-level sunken roads make a confusing start.)
 * yaw rotates the car's +Z nose; π/2 faces east toward the station.
 */
export const SPAWN = { lat: 35.68075, lon: 139.76345, yaw: Math.PI / 2 };

export const TERRAIN_ZOOM = 15;
export const TERRAIN_RENDER_RADIUS = 2; // chunks (z15 tile ≈ 990 m in Tokyo)
export const TERRAIN_COLLIDER_RADIUS = 1;
export const TERRAIN_SEGMENTS = 64;
export const RECENTER_DISTANCE = 1500; // metres from origin before re-anchoring the frame
export const BUILDING_COLLIDER_RADIUS = 260;
export const POI_VISIBLE_RADIUS = 1800;
export const POI_COLLECT_RADIUS = 14;
export const GEOID_FALLBACK = 36.9; // metres, Tokyo-area average used if geoid.json is missing
