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
 * `blocked` and `decks` on chunks, `portal` ends. 4 (P7): `street` chunks and runs (a structure's
 * lower floor), `over` on chunks (a deck built to a landmark's deck levels), `ranges` and
 * `structures` in meta. 3 is P6's (maxspeed per chunk), kept apart so neither branch reads the
 * other's data; merging both is 5. P2.6's optional `vform` (chunks) and `closed` (meta) need no
 * reader, so they stay within 4, as do G6's optional `signs` and `posted` (chunks) and `entrances`
 * (meta): the game reads them only where present. P9's tunnels and cuts (`tunnel` / `cut` chunks,
 * their `portals`, `seam` ends) need a reader: they are named in meta's `features` (XW_FEATURES)
 * and a reader refuses a feature it does not know. The game refuses another version.
 */
export const XW_VERSION = 4;

/**
 * Optional parts of the format a file may use within its version (meta.json `features`). "below"
 * (P9): `tunnel` / `cut` chunks, their `portals`, and `seam` ends between runs. A reader refuses a
 * file naming a feature it does not know (expresswayDeck.ts isSupportedMeta), so P9's data cannot be
 * read as plain P7 data by a newer reader that lacks P9. Why not version 5 now: P6 (3) and P7 (4)
 * are merged into 5 when the branches meet; until then the version stays P7's.
 */
export const XW_FEATURES = ["below"] as const;
export type XwFeature = (typeof XW_FEATURES)[number];
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
  cls: XwClass;
  ref: string | null;
  name: string | null;
  /**
   * What carries the chunk: a viaduct (the deck, girder and piers), or below the ground (P9) a
   * tunnel (floor, walls, walkways and roof) or a cut (floor and retaining walls up to the ground).
   * A below chunk has no girder (`girder` 0), piers, crossings nor blocked roads.
   */
  structure: "viaduct" | "tunnel" | "cut";
  /**
   * Where the road passes from one structure to the next inside this chunk (P9): the portals of a
   * tunnel or cut. Left out when there are none (every viaduct chunk), so P7's chunks are unchanged.
   */
  portals?: XwPortal[];
  /**
   * A deck built to a landmark's deck levels (structures.ts), or null: then the chunk has no
   * girder (`girder` 0) nor piers, its section comes from the level's strips, and the slab goes on
   * past each 壁高欄 as an apron that is drawn only (no collider: a guideway, a walkway).
   */
  over: XwOver | null;
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
   * format version does not change (no reader needs it: the stations carry the surface).
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
  /**
   * The signs standing on this chunk's deck (G6, src/expressway/signPlan.ts): added without a
   * version step (an older reader ignores the field; the game reads it only when present).
   */
  signs?: XwSign[];
  /**
   * The posted speed on this chunk, km/h (G6, signPlan.ts postedOf): the 323 plates show it and the
   * graph's limit is it. Optional like `signs`.
   */
  posted?: number;
};

/**
 * How a sign on a deck is held (src/signs/mount.ts): a 門型 over the carriageway, hung on the
 * girder of a deck above, or clamped on a 壁高欄.
 */
export type XwSignMount = "gantry" | "girder-mount" | "barrier-mount";

/** The guide boards the planner writes (their content is a BoardContent, checked by zod both ends). */
export type XwBoardKind = "108の2-C" | "110-B" | "111-B" | "112-B" | "113-A" | "113-B" | "116の4" | "116の6";

/**
 * One sign on a deck. `s` is the run distance (the chunk's run), `z` the road surface there (T.P.
 * m) and `level` the deck's (1: the first deck over the streets): a sign on a deck carries its
 * height so the game stands it there, not on the ground. `side` is the 壁高欄 it is clamped on or
 * "over" the carriageway; `board` the guide board's content (BoardContent, src/signs/board/
 * content.ts), `plate` a 規制標識 (323 with its km/h, 325). `girder`: under a deck above, its
 * underside and depth in metres above this road. `ref`: what it is for (the exit's or JCT's node,
 * the distance before it), for the checks and the review.
 */
export type XwSign = {
  id: string;
  s: number;
  z: number;
  level: number;
  side: "left" | "right" | "over";
  mount: XwSignMount;
  board?: unknown;
  plate?: { id: "323" | "325"; value: number | null };
  girder?: { bottomM: number; depthM: number };
  /** 111-B: the side of the exit's lane it hangs over. */
  lane?: "left" | "right";
  ref: { kind: "exit" | "jct" | "entrance" | "phone" | "run"; node: number | null; beforeM: number };
};

/** The road classes in the data: the expressway, its ramps, and a structure's streets. */
export type XwClass = "expressway" | "ramp" | "street";

export type XwOver = {
  /** `<landmark>:<level>:<direction>` (structures.ts StructureDeck.id). */
  deck: string;
  level: "upper" | "lower";
  /** Render-only slab beyond the left and right 壁高欄's outer faces (m). */
  apronL: number;
  apronR: number;
};

/** What carries the road on either side of a portal ("ground": at grade, not compiled). */
export type XwStructure = "viaduct" | "ground" | "tunnel" | "cut";

/**
 * A portal (P9): at run distance s the road passes from `from` to `to` (the travel direction). At a
 * below run's first and last station `from` / `to` is what comes before and after it.
 */
export type XwPortal = { s: number; from: XwStructure; to: XwStructure };

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
  cls: XwClass;
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
  /** The structure deck this run carries over a landmark (null for an ordinary run). */
  structure: XwRunStructure | null;
};

/** How a run met its structure's deck levels (structures.ts; the build fails beyond the tolerances). */
export type XwRunStructure = {
  deck: string;
  /** s along the run where the pinned stretch (the structure's sRange) starts and ends. */
  s0: number;
  s1: number;
  /** Largest horizontal distance of the OSM line from axis + strip centre (the 3 m rule). */
  osmM: number;
  /** Largest distance of the compiled centre line from axis + band centre, and of z from the formula. */
  planM: number;
  zM: number;
};

export type XwDiagnostic = { run: string; kind: string; detail: string; allowed: boolean };

/**
 * A run of the range that is not in the tiles (its profile could not be solved, or it hangs from
 * one that could not): the game closes it (P3 leaves it out of the graph), `reason` the diagnostic
 * kind with the details in `diagnostics`.
 */
export type XwClosed = { run: string; chain: string; cls: XwClass; reason: string };

export type XwMeta = {
  version: typeof XW_VERSION;
  /** The optional parts of the format the files use (XW_FEATURES); absent in P7's files. */
  features?: string[];
  zoom: number;
  tiles: string[];
  /** The named ranges built (empty for --range all). */
  ranges: Array<{ name: string; minLon: number; minLat: number; maxLon: number; maxLat: number }>;
  /** Structures whose deck levels were built (landmark id and the version of its deckLevels). */
  structures: Array<{ id: string; version: number; decks: string[] }>;
  extract: { url: string; timestamp: string | null };
  counts: { runs: number; chunks: number; stations: number; piers: number; crossings: number };
  bytes: number;
  /** The joint vertical solves (no timings: the file stays byte-stable). */
  solver: { components: number; solves: number; unconverged: number };
  runs: XwRunSummary[];
  /** Runs of the range left out of the tiles, closed (optional: absent in files before P2.6). */
  closed?: XwClosed[];
  diagnostics: XwDiagnostic[];
  /**
   * The entrances (G6): where each entrance ramp leaves the street (its ground end), its real name
   * and route, for the 103・104 the game stands on the street side at run time. Optional like
   * `XwChunk.signs` (no version step).
   */
  entrances?: XwEntrance[];
};

export type XwEntrance = {
  /** The entrance ramp's run. */
  run: string;
  /** Its ground end: where it leaves the street, and the heading up the ramp (radians, as h0). */
  lon: number;
  lat: number;
  heading: number;
  /** The entrance's name without 入口 (「芝公園」), its English, the route symbol and name it joins. */
  name: string | null;
  nameEn: string | null;
  route: string | null;
  routeName: string | null;
  routeNameEn: string | null;
};
