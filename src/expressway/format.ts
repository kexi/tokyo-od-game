/**
 * The files scripts/expressway.ts writes under public/data/expressway and the game reads
 * (src/world/expresswayDeck.ts). Stations are flat arrays to keep the JSON small.
 */

/**
 * Values per station in `XwChunk.st`: s (m from the run start), lon, lat, z (T.P. m), bank,
 * ground (T.P. m), grade. Between stations the surface is the cubic Hermite of z and grade
 * (profile.ts), the plan position linear.
 */
export const STATION_STRIDE = 7;
/** Offsets within a station of `XwChunk.st`: read stations only through these. */
export const ST = { s: 0, lon: 1, lat: 2, z: 3, bank: 4, ground: 5, grade: 6 } as const;
/**
 * Data format version in meta.json. 2: stations of 7 values (grade added, Hermite surface),
 * `blocked` and `decks` on chunks, `portal` ends. The game refuses another version.
 */
export const XW_VERSION = 2;
/** Values per pier in `XwChunk.piers`: s, ground (T.P. m). */
export const PIER_STRIDE = 2;
/**
 * Values per crossing in `XwChunk.cross`: s, the top of what is crossed (T.P. m), the clearance
 * required (m, building limit + girder), and the road surface there (T.P. m).
 */
export const CROSS_STRIDE = 4;
/**
 * Values per entry in `XwChunk.blocked`: s, the top of a road at ground level under the deck
 * (T.P. m), and the road surface there (T.P. m). These are the roads near a ground end that the
 * deck does not clear (`crossing_over_or_at_grade`): P3 closes or reroutes them.
 */
export const BLOCKED_STRIDE = 3;

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
  /**
   * Design speed of this section (km/h): set per stretch of the run (a tight curve lowers it only
   * around the curve), and chunks are cut where it changes.
   */
  V: number;
  /** Vertical knot spacing of the run (= the length of every vertical curve). */
  vh: number;
  /**
   * "cubic": the run is a short 連結路 whose elevation is one cubic Hermite between its two parents'
   * points (vertical.ts), so `vh` is the run length and no 第22条 minimum length applies (第28条
   * 第4項); the stations carry the cubic exactly. Absent: parabolas of length `vh`. Optional, so the
   * format stays version 2.
   */
  vform?: "cubic";
  /** Grade limit of this section (第20条 standard or 特例 for `V`, capped by 第25条). */
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
  blocked: number[];
  /**
   * Stretches [s0, s1] of this chunk whose carriageway lies over or under another run's, and how
   * they stand to it (the compiler's relation: one surface, or a level above / below). P3 reads
   * these instead of finding the overlaps again at run time.
   */
  decks: XwDeckStretch[];
  prev: string | null;
  next: string | null;
};

export type XwDeckStretch = { with: string; relation: "same" | "above" | "below"; s0: number; s1: number };

export type XwTile = { chunks: XwChunk[] };

export type XwEnd = {
  /**
   * ground: meets the ground at its grade (the road continues at grade). portal: meets the ground
   * where the road goes on into a tunnel or cut (`into`), so the grade is left free. junction /
   * seam: takes another run's value.
   */
  kind: "ground" | "portal" | "junction" | "open" | "seam";
  into?: "tunnel" | "cut";
  /** For a junction or seam: the run whose value was taken, and where on it. */
  parent?: string;
  parentS?: number;
  z?: number;
  grade?: number;
  bank?: number;
  /** For a ground or portal end: the ground elevation there (T.P. m). */
  ground?: number;
};

export type XwRunSummary = {
  id: string;
  chain: string;
  cls: "expressway" | "ramp";
  ref: string | null;
  lengthM: number;
  /** Highest design speed along the run (each chunk has its own section's `V`). */
  V: number;
  /** Highest speed from OSM maxspeed / default along the run, before the radius check lowered it. */
  tagV: number;
  /**
   * Highest speed after the radius check, before a vertical fallback lowered it (sets the climb
   * length from a ground end).
   */
  planV: number;
  minRadiusM: number;
  maxShiftM: number;
  steps: string[];
  start: XwEnd;
  end: XwEnd;
  chunks: string[];
};

export type XwDiagnostic = { run: string; kind: string; detail: string; allowed: boolean };

/**
 * A run of the range that is not in the tiles (its profile could not be solved, or it hangs from
 * one that could not): the game closes it (P3 leaves it out of the graph), `reason` the diagnostic
 * kind with the details in `diagnostics`.
 */
export type XwClosed = { run: string; chain: string; cls: "expressway" | "ramp"; reason: string };

export type XwMeta = {
  version: typeof XW_VERSION;
  zoom: number;
  tiles: string[];
  range: { name: string; minLon: number; minLat: number; maxLon: number; maxLat: number } | null;
  extract: { url: string; timestamp: string | null };
  counts: { runs: number; chunks: number; stations: number; piers: number; crossings: number };
  bytes: number;
  /** The joint vertical solves (no timings: the file stays byte-stable). */
  solver: { components: number; solves: number; unconverged: number };
  runs: XwRunSummary[];
  /** Runs of the range left out of the tiles, closed (optional: absent in files before P2.6). */
  closed?: XwClosed[];
  diagnostics: XwDiagnostic[];
};
