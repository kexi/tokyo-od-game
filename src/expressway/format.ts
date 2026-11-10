/**
 * The files scripts/expressway.ts writes under public/data/expressway and the game reads
 * (src/world/expresswayDeck.ts). Stations are flat arrays to keep the JSON small.
 */

/** Values per station in `XwChunk.st`: s (m from the run start), lon, lat, z (T.P. m), bank, ground (T.P. m). */
export const STATION_STRIDE = 6;
/** Values per pier in `XwChunk.piers`: s, ground (T.P. m). */
export const PIER_STRIDE = 2;
/**
 * Values per crossing in `XwChunk.cross`: s, the top of what is crossed (T.P. m), the clearance
 * required (m, building limit + girder), and the road surface there (T.P. m).
 */
export const CROSS_STRIDE = 4;

export type XwChunk = {
  /** `<run>:<k>`, stable across builds and ranges. */
  id: string;
  run: string;
  chain: string;
  k: number;
  cls: "expressway" | "ramp";
  ref: string | null;
  name: string | null;
  structure: "viaduct";
  lanes: number;
  laneWidth: number;
  shoulderL: number;
  shoulderR: number;
  basis: "statute" | "assumption";
  /** Design speed the alignment was solved for (km/h). */
  V: number;
  /** Vertical knot spacing of the run (= the length of every vertical curve). */
  vh: number;
  /** Grade limit the run was solved with (第20条 standard or 特例). */
  gmax: number;
  /** Grade at the chunk's first and last station (stations alone cannot give it on a curve). */
  g0: number;
  g1: number;
  /**
   * Plan heading at the first and last station (radians, anticlockwise from east on the lon/lat
   * grid scaled by cos(lat)): consecutive chunks share it, so their cross-sections meet edge to edge.
   */
  h0: number;
  h1: number;
  /** Girder depth below the road surface (assumptions.GIRDER_DEPTH). */
  girder: number;
  st: number[];
  piers: number[];
  cross: number[];
  prev: string | null;
  next: string | null;
};

export type XwTile = { chunks: XwChunk[] };

export type XwEnd = {
  kind: "ground" | "junction" | "open" | "seam";
  /** For a junction or seam: the run whose value was taken, and where on it. */
  parent?: string;
  parentS?: number;
  z?: number;
  grade?: number;
  bank?: number;
  /** For a ground end: the ground elevation there (T.P. m). */
  ground?: number;
};

export type XwRunSummary = {
  id: string;
  chain: string;
  cls: "expressway" | "ramp";
  ref: string | null;
  lengthM: number;
  V: number;
  /** Speed from OSM maxspeed / default, before the radius check lowered it. */
  tagV: number;
  /** Speed after the radius check, before a vertical fallback lowered it (sets the climb length). */
  planV: number;
  minRadiusM: number;
  maxShiftM: number;
  steps: string[];
  start: XwEnd;
  end: XwEnd;
  chunks: string[];
};

export type XwDiagnostic = { run: string; kind: string; detail: string; allowed: boolean };

export type XwMeta = {
  version: 1;
  zoom: number;
  tiles: string[];
  range: { name: string; minLon: number; minLat: number; maxLon: number; maxLat: number } | null;
  extract: { url: string; timestamp: string | null };
  counts: { runs: number; chunks: number; stations: number; piers: number; crossings: number };
  bytes: number;
  runs: XwRunSummary[];
  diagnostics: XwDiagnostic[];
};
