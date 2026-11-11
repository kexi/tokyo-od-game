/**
 * The row layout of public/data/roadlanes (OSM street lanes), shared by the build
 * (scripts/regulations.ts, scripts/roadLanes.ts) and the game (regulations.ts osmLaneMatcher), so
 * neither writes the offsets by hand. A change of layout bumps ROAD_LANES_SCHEMA, which the build
 * writes into meta.json.
 *
 * Row: [forward lanes, backward lanes (0 = not mapped), one-way 1/0, width dm (0 = none), OSM layer,
 * …lon, lat in the forward order].
 */
export const ROAD_LANES_SCHEMA = 2;

export const ROAD_LANES_COLUMN = {
  forward: 0,
  backward: 1,
  oneway: 2,
  widthDm: 3,
  layer: 4,
  /** Where the coordinates start. */
  coords: 5,
} as const;
