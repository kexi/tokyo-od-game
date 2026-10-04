// Static endpoints and tuning constants. All remote endpoints here were verified to send
// `Access-Control-Allow-Origin: *`, which is what lets the game run on static GitHub Pages.

/**
 * PLATEAU LOD1 for all of Tokyo. LOD2 was tried and dropped: it exists for fewer
 * municipalities (45 vs 62 sub-tilesets), its textured tiles exhaust a 1.6 GB cache within
 * ~1 km, and its intermediate levels contain decimated wall fragments that float in the air.
 */
export const PLATEAU_TILESET =
  "https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/13-bldg-lod1-latest/tileset.json";

export const GSI = {
  dem5a: (z: number, x: number, y: number) =>
    `https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/${z}/${x}/${y}.png`,
  dem10: (z: number, x: number, y: number) =>
    `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${z}/${x}/${y}.png`,
  photo: (z: number, x: number, y: number) =>
    `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${z}/${x}/${y}.jpg`,
  reverseGeocode: (lat: number, lon: number) =>
    `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`,
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
