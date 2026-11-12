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
 * and a reader refuses a feature it does not know. 5 (P6 with P7): `maxspeed` on every chunk
 * (the raw OSM tag, chunks cut where it changes; the graph's limit is still `posted`, which G6's
 * carry rules derive from the same tags). 6 (P2.7-4): meta.json is an index only (its size grows
 * with the tiles, not with the runs); the run summaries the game reads (`XwTileRun`) and the
 * entrances go into the tiles, and the build's record (the full run summaries, diagnostics, closed
 * runs, the solver, the blocks) into report.json (`XwBuildRecord`), which the game never reads. The
 * chunks are as in 5. The game refuses another version.
 */
export const XW_VERSION = 6;

/**
 * Optional parts of the format a file may use within its version (meta.json `features`). "below"
 * (P9): `tunnel` / `cut` chunks, their `portals`, and `seam` ends between runs. A reader refuses a
 * file naming a feature it does not know (expresswayDeck.ts isSupportedMeta), so P9's data cannot be
 * read as plain P7 data by a newer reader that lacks P9. P6 (3) and P7 (4) met in 5, which
 * keeps the feature list. "height-structures" (P2.7-6 PR 1, `--structures height`): a viaduct-tagged
 * run's chunks may be `embankment` (retaining walls down to the ground, no piers) or `cut` (as a below
 * run's) where its solved height says so, with `portals` where the structure changes. A build with
 * the tags' structures (the default) names only "below", so its files are as before.
 */
export const XW_FEATURES = ["below", "height-structures"] as const;
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
   * A below chunk has no girder (`girder` 0), piers, crossings nor blocked roads. An embankment
   * ("height-structures", P2.7-6): a deck over the ground but under the open-ground floor, walled
   * from the slab's edges down to the ground, with no piers and nothing crossed under it (a road
   * there is blocked).
   */
  structure: "viaduct" | "embankment" | "tunnel" | "cut";
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
  /**
   * OSM maxspeed as tagged on the way this chunk lies on (km/h), or null where the way has none.
   * Chunks are cut where it changes. The graph's limit is `posted` (G6's carry rules over the same
   * tags), this only where a file has no `posted`. Not the design speed `V`.
   */
  maxspeed: number | null;
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
  /**
   * A height build's half window of each `cross` entry along the deck (m, S6 PR 7a R6 (d)): the width
   * the road takes under it, which T4 checks every metre over with the girder of the chunk there.
   * Optional, so the format version does not change; absent in a build by the tags.
   */
  crossWindows?: number[];
  blocked: number[];
  /**
   * A height build's low spans (S6 PR 7a2): per `blocked` entry, the half window the deck spans over
   * it though short of 4.5 m (0 where it is not spanned low). Only on a chunk holding one; optional, so
   * the format version does not change.
   */
  blockedWindows?: number[];
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
  /**
   * A gantry over a carriageway that shares one slab with the opposite one (decks `same`, P3.5's
   * dividing wall at the middle of their overlap): that wall's lateral offset from the centre line
   * (m, + left), where the median-side leg stands (P2.7-5). Absent: both legs on the 壁高欄.
   */
  divider?: number;
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
export type XwStructure = "viaduct" | "embankment" | "ground" | "tunnel" | "cut";

/**
 * A portal (P9): at run distance s the road passes from `from` to `to` (the travel direction). At a
 * below run's first and last station `from` / `to` is what comes before and after it.
 */
export type XwPortal = { s: number; from: XwStructure; to: XwStructure };

export type XwDeckStretch = { with: string; relation: "same" | "above" | "below"; s0: number; s1: number };

/**
 * A z14 tile `<x>-<y>.json`: its chunks (each filed under its middle station), the run summaries
 * the game reads for every run with a chunk here (repeated in each such tile, so the 分合流 roles
 * — expresswayMarkings.ts roleOf — come out the same whichever tile is read first), and the
 * entrances whose ground end lies in it (left out where there are none). Runs and entrances by id.
 */
export type XwTile = { chunks: XwChunk[]; runs: XwTileRun[]; entrances?: XwEntrance[] };

/**
 * What the game reads of a run (v6): its class and its two ends (the 分合流 points inserted into
 * the parent's line, the ground ends, roleOf). The full summary is in report.json.
 */
export type XwTileRun = Pick<XwRunSummary, "id" | "cls" | "start" | "end">;

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
  /**
   * `--ramp-shift` (S6 PR 4): how far the run's line lies off OSM where it was moved off a main line
   * (the farthest of its shifted samples, horizontal.ts `PlanAlignment.shifted`, compile.ts rampShiftOf). Absent where nothing moved.
   */
  rampShiftM?: number;
  /** The cap the run was moved to (`--ramp-shift <m>`), with `rampShiftM`: T6 holds the move within it and ε. */
  rampShiftCapM?: number;
  steps: string[];
  start: XwEnd;
  end: XwEnd;
  chunks: string[];
  /** The structure deck this run carries over a landmark (null for an ordinary run). */
  structure: XwRunStructure | null;
  /**
   * A below run by its tags (P9), in a height build only (P2.7-6): there a viaduct-tagged run may be
   * all cut too. Absent elsewhere.
   */
  below?: true;
  /** A run at grade (S6 PR 2, `--ground compile`), in a height build only. */
  ground?: true;
  /**
   * A run at grade's road against its target line (S6 PR 7a, compile.ts groundFitOf): the inside's
   * |road − line| p95 and (road − line) median, and the largest |road − line| over its approaches (from
   * a seam 150 m, from a ground end, portal or junction 100 m). The ledger's ground-stretch reads it.
   * Absent elsewhere and before PR 7a.
   */
  groundFit?: XwGroundFit;
};

export type XwGroundFit = {
  approachM: [number, number];
  innerP95M: number | null;
  innerMedianM: number | null;
  approachMaxM: number;
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

/**
 * meta.json (v6): the index the game reads at start-up, sized by the tiles alone. What each tile
 * holds is in the tile, what the build found is in report.json (XwBuildRecord).
 */
export type XwMeta = {
  version: typeof XW_VERSION;
  /** The optional parts of the format the files use (XW_FEATURES); absent in P7's files. */
  features?: string[];
  zoom: number;
  tiles: string[];
  /** The named ranges built (empty for --range all and --range ship). */
  ranges: Array<{ name: string; minLon: number; minLat: number; maxLon: number; maxLat: number }>;
  /**
   * "ship" for --range ship (P2.7-1, src/expressway/scope.ts: the urban expressway over the 23
   * wards). Optional, absent from the default build's file.
   */
  scope?: "ship";
  /** Structures whose deck levels were built (landmark id and the version of its deckLevels). */
  structures: Array<{ id: string; version: number; decks: string[] }>;
  extract: { url: string; timestamp: string | null };
  counts: { runs: number; chunks: number; stations: number; piers: number; crossings: number };
  /** Bytes of the tile files (not meta.json, report.json nor ledger.json). */
  bytes: number;
};

/** report.json's own version (XwBuildRecord). */
export const XW_RECORD_VERSION = 1;

/**
 * report.json (v6): what the build found, for the tests and the tools (scripts/expresswayLedger.ts,
 * the data tests); the game never reads it. Not the scorecard (`--report`, report.ts ReportSchema,
 * written outside the data folder with timings): this one sits in the data folder, byte-stable.
 */
export type XwBuildRecord = {
  version: typeof XW_RECORD_VERSION;
  /** The vertical objective the decks were solved with (compile.ts Objective kind). */
  objective: "v1" | "v2";
  /** The joint vertical solves (no timings: the file stays byte-stable). */
  solver: {
    components: number;
    solves: number;
    unconverged: number;
    /** Solves solved again after a first try that did not converge (P2.7-5; absent when none). */
    retried?: number;
  };
  /**
   * The runs at grade's target weight and band as built (S6 PR 7a: HEIGHT_STRUCTURES.ground or the
   * sweep's `--ground-target-scale` / `--ground-band`), only with `--ground compile`.
   */
  ground?: { targetScale: number; bandM: number };
  runs: XwRunSummary[];
  /** Runs of the range left out of the tiles, closed. */
  closed: XwClosed[];
  diagnostics: XwDiagnostic[];
  /**
   * Run pairs among the needed runs not held a level apart (compile.ts markSharedTouchdowns,
   * P2.7-3a), a < b: their overlaps are the ledger's `touchdown` kind.
   */
  untied: Array<{ a: string; b: string; stations: number }>;
  /**
   * The blocks solved (a component each for --partition components) with their written runs and
   * `dataHash`: SHA-256 of the JSON of those runs' chunks as written (run id, then k, ascending).
   * Made from the rounded values in the files, so a solver's 1e-12 m wobble leaves it alone. Not the
   * scorecard's solution hash (`partition.blocks[].hash`, of the solver's unrounded solution).
   */
  blocks: XwBlockRecord[];
};

export type XwBlockRecord = { id: string; runs: string[]; dataHash: string };

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
