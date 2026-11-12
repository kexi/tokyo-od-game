// Build-time expressway compiler (knowledge/road-redesign-plan.md 4): OSM motorway / motorway_link from the Geofabrik Kanto
// extract → plan and vertical alignment within 道路構造令 (src/expressway/) → public/data/expressway/
// <x>-<y>.json (z14 tiles of ≤ 300 m chunks) and meta.json. The ground constraints read GSI DEM
// tiles exactly as the game does (scripts/demTiles.ts), cached under .cache/gsi-dem.
// Run: pnpm exec tsx scripts/expressway.ts [--range hamazakibashi,rainbow,azabudai|all|ship] [--below pruned|all] [--ledger <path>]
//   [--partition components|blocks [--quiet-factor <k>]]
//   [--pbf <path>] [--out <dir>] [--report <path> [--label <name>] [--baseline <path>]] [--accept-extract]
// (--range takes one or more named ranges joined by commas; the default is DEFAULT_RANGES.)
// Structure overrides (src/expressway/structures.ts): the deck levels of the landmarks in
// public/data/landmarks.json (レインボーブリッジ) pin the decks they carry, and the street ways they
// name are compiled too. Build order: landmarks (just make-all-landmark-models) → this script.
// (--out writes somewhere else than public/data/expressway, e.g. to measure --range all.)
// (the OSM extract is the one just fetch-regs caches in .cache/osm; it is downloaded if missing).
// P2.7-1: --range ship builds the shipped scope (src/expressway/scope.ts: the urban expressway over
// the 23 wards and its ramps); --below all compiles every tunnel and cut (no pruneBelow, to measure
// only); --report <path> writes the scorecard (src/expressway/report.ts) there, outside the data
// folder (it has timings), with --label naming it; --baseline <path> also writes it without the
// timings (the committed tests/fixtures/expresswayScorecard.ship.json). The extract is pinned
// (src/expressway/extract.ts): the build reads .cache/osm/kanto-<timestamp>.osm.pbf, copied once
// from kanto-latest.osm.pbf while that is still the pinned extract; another extract stops the
// build unless --accept-extract is given.
// P2.7-2: --partition blocks cuts the main lines at anchors in their quiet stretches and solves block
// by block (src/expressway/blocks.ts; measuring only, like --below all it needs --out), with
// --quiet-factor <k> the anchors' margin (assumptions.BLOCK_QUIET_FACTOR by default). The default,
// --partition components, solves each component in one QP as before.
// P2.7-3: --objective v2 aims the decks at the design ground line and charges grade changes in L1
// (compile.ts Objective), with --grade-change <w> (vertical.ts W_GRADE_CHANGE), --reach <m> and
// --reach-below <m> (assumptions.DESIGN_GROUND_REACH) and --target-scale <k> (W_TARGET × k).
// P2.7-5 made v2 the default; --objective v1 (the objective before it) is for comparing and needs --out.
// P2.7-6 (S6), each measuring only and needing --out until PR 7: --structures height (the structures from
// the solved height), --ground compile (the runs at grade, needs height), --touchdown all (every class's
// pairs coming down to the same place let go) and --companions on [--companion-weight <w>] (main lines
// beside each other held to one height; the station pairs go to <report>.companions.json).
// P2.7-4 (format 6): meta.json is the tiles' index; each tile carries its chunks, the summaries of
// their runs and the entrances whose street end lies in it; report.json the build's record (runs,
// diagnostics, closed runs, the solver, the blocks with the dataHash of their chunks). A diagnostic
// is allowed by the rules (allowlist.ts) or by the ledger (ledger.json of the output folder, kept
// across the rebuild, or --ledger <path>), which scripts/expresswayLedger.ts writes.
// P2.7-6 PR 1: --structures height (measuring only, needs --out) draws a viaduct-tagged run's stretches
// as viaduct, embankment or cut from its solved height (src/expressway/heightStructures.ts) and names
// "height-structures" in meta's features; --structures tags (the default) leaves the files as before.
import { shippedFolderRefusal } from "./expresswayGuards";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { AreaIndex, type AreaFile } from "../src/geo/areas.ts";
import {
  checkExtract,
  EXPECTED_EXTRACT_SHA256,
  EXPECTED_EXTRACT_TIMESTAMP,
  pinnedExtractName,
} from "../src/expressway/extract.ts";
import { violationsOf } from "../src/expressway/violations.ts";
import { isAllowed } from "../src/expressway/allowlist.ts";
import { caseContextOf, type Ledger, ledgerVerdict, rampFloorOf } from "../src/expressway/ledger.ts";
import { BLOCK_QUIET_FACTOR, COMPANIONS, HEIGHT_STRUCTURES } from "../src/expressway/assumptions.ts";
import { surfaceAt } from "../src/expressway/profile.ts";
import { buildReport, type PlannedRun, type Report, trackingOf } from "../src/expressway/report.ts";
import { scopeExtent, shipRuns } from "../src/expressway/scope.ts";
import { DEFAULT_RANGES, parseRanges, RANGES } from "../src/expressway/ranges.ts";
import { packTiles } from "../src/expressway/files.ts";
import { assignDistricts, type District, districtRunsOf } from "../src/expressway/districts.ts";
import { STRUCTURE_SPECS, type Structure, structureFrom } from "../src/expressway/structures.ts";
import { deckLevelsOf, DECK_LEVELS_VERSION } from "../src/world/deckLevels.ts";
import {
  type Bbox,
  type BlockSummary,
  type CrossObject,
  groundPoints,
  OBJECTIVE_V1,
  OBJECTIVE_V2,
  type Objective,
  mainLineHoles,
  planNetwork,
  untiedPairs,
  solvePlan,
} from "../src/expressway/compile.ts";
import {
  CROSS_STRIDE,
  PIER_STRIDE,
  STATION_STRIDE,
  type XwBlockRecord,
  type XwBuildRecord,
  type XwChunk,
  type XwMeta,
  XW_FEATURES,
  XW_RECORD_VERSION,
  XW_VERSION,
} from "../src/expressway/format.ts";
import { tileKey } from "../src/expressway/geo.ts";
import { planSigns } from "../src/expressway/signPlan.ts";
import {
  type Network,
  normalizeNode,
  normalizeStreetWay,
  normalizeWay,
  type XwNode,
  type XwWay,
} from "../src/expressway/network.ts";
import { log, warn } from "../src/log.ts";
import { BuildDem } from "./demTiles.ts";
import {
  readNodeCoords,
  readNodeCoordsWhere,
  readReplicationTimestamp,
  readTaggedNodes,
  readWays,
  readWaysById,
} from "./osm-pbf.ts";

const started = performance.now();
const OUT_DEFAULT = join(import.meta.dirname, "..", "public", "data", "expressway");
const OSM_EXTRACT = "https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf";
const OSM_DIR = join(import.meta.dirname, "..", ".cache", "osm");
/** What just fetch-regs keeps fresh (re-downloaded in place once a week old): never read directly. */
const OSM_LATEST = join(OSM_DIR, "kanto-latest.osm.pbf");
/** The pinned copy the expressway is built from (extract.ts). */
const OSM_PINNED = join(OSM_DIR, pinnedExtractName());
const USER_AGENT = "tokyo-od-game-databuild/0.1 (+https://github.com/kexi/tokyo-od-game)";
const Z = 14;
/**
 * The ways the compiler knows about: the 23 wards with a margin. Fixed, so a chain (and every id
 * derived from it) is the same whichever --range is built.
 */
const UNIVERSE: Bbox = { minLon: 139.5, minLat: 35.45, maxLon: 139.98, maxLat: 35.87 };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const hasFile = (path: string) =>
  stat(path).then(
    (s) => s.size > 0,
    () => false,
  );

async function download(path: string): Promise<void> {
  log("download", { url: OSM_EXTRACT });
  const res = await fetch(OSM_EXTRACT, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${OSM_EXTRACT}: HTTP ${res.status}`);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, new Uint8Array(await res.arrayBuffer()));
}

const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Raw and gzip bytes of a file's text (the scorecard's size). */
const sizeOf = (text: string) => ({ raw: Buffer.byteLength(text), gzip: gzipSync(text).length });

/**
 * report.json's blocks (P2.7-4 5.5): each block's runs and the SHA-256 of the JSON of their chunks
 * as written (run id, then k), so the ledger can tell a block that did not change from one that did.
 * Why not the solver's hash: it is of the unrounded solution, which a 1e-12 m wobble changes.
 */
function blockRecords(blocks: ReadonlyArray<BlockSummary>, chunks: ReadonlyArray<XwChunk>): XwBlockRecord[] {
  const byRun = new Map<string, XwChunk[]>();
  for (const c of chunks) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c]);
  return blocks.map((b) => {
    const written = b.members.flatMap((run) => (byRun.get(run) ?? []).toSorted((x, y) => x.k - y.k));
    const text = JSON.stringify(written);
    return { id: b.id, runs: b.members, dataHash: sha256Of(new TextEncoder().encode(text)) };
  });
}

/**
 * The extract to build from: --pbf as given; else the pinned copy, made from kanto-latest (downloaded
 * if missing) when that is still the pinned extract (timestamp and SHA-256). With --accept-extract
 * and no pinned copy, kanto-latest itself. Why copy and not link: fetch-regs rewrites kanto-latest
 * in place, which a link would follow. kanto-latest is never removed (worktrees share .cache/osm).
 */
async function extract(given: string | undefined, accept: boolean): Promise<Uint8Array> {
  if (given) return new Uint8Array(await readFile(given));
  if (await hasFile(OSM_PINNED)) return new Uint8Array(await readFile(OSM_PINNED));
  if (!(await hasFile(OSM_LATEST))) await download(OSM_LATEST);
  const latest = new Uint8Array(await readFile(OSM_LATEST));
  const timestamp = readReplicationTimestamp(latest);
  const isPinned = timestamp === EXPECTED_EXTRACT_TIMESTAMP && sha256Of(latest) === EXPECTED_EXTRACT_SHA256;
  if (!isPinned) {
    const check = checkExtract(timestamp, accept, sha256Of(latest));
    if (!check.ok) throw new Error(`${check.reason} (no ${OSM_PINNED})`);
    return latest;
  }
  const partial = `${OSM_PINNED}.partial`;
  await copyFile(OSM_LATEST, partial);
  await rename(partial, OSM_PINNED);
  log("expressway_extract_pinned", { file: OSM_PINNED, timestamp, sha256: EXPECTED_EXTRACT_SHA256 });
  return latest;
}

const inBox = (b: Bbox, lon: number, lat: number) =>
  lon >= b.minLon && lon <= b.maxLon && lat >= b.minLat && lat <= b.maxLat;

const rangeArg = arg("range") ?? DEFAULT_RANGES.join(",");
const { names: rangeNames, boxes: ranges, scope } = parseRanges(arg("range"));
const belowArg = arg("below") ?? "pruned";
const isBelowMode = belowArg === "pruned" || belowArg === "all";
if (!isBelowMode) throw new Error(`unknown --below ${belowArg} (pruned, all)`);
const below = belowArg as "pruned" | "all";
const reportPath = arg("report");
const baselinePath = arg("baseline");
const partitionArg = arg("partition") ?? "components";
const isPartitionMode = partitionArg === "components" || partitionArg === "blocks";
if (!isPartitionMode) throw new Error(`unknown --partition ${partitionArg} (components, blocks)`);
const partitionMode = partitionArg as "components" | "blocks";
const quietFactor = Number(arg("quiet-factor") ?? BLOCK_QUIET_FACTOR.value);
// P2.7-5: v2 is the default (the decks do not follow the DEM's bumps); v1 stays to compare against.
const objectiveArg = arg("objective") ?? "v2";
const isObjectiveKind = objectiveArg === "v1" || objectiveArg === "v2";
if (!isObjectiveKind) throw new Error(`unknown --objective ${objectiveArg} (v1, v2)`);
const V2_FLAGS = ["grade-change", "reach", "reach-below", "target-scale"];
const v2Flags = V2_FLAGS.filter((name) => arg(name) !== undefined);
const isV1WithV2Flags = objectiveArg === "v1" && v2Flags.length > 0;
if (isV1WithV2Flags) throw new Error(`--${v2Flags[0]} is for --objective v2`);
/** A v2 weight from its flag, or the assumed one; a flag that is no positive number stops the build. */
const v2Number = (name: string, fallback: number) => {
  const text = arg(name);
  if (text === undefined) return fallback;
  const value = Number(text);
  const isPositive = Number.isFinite(value) && value > 0;
  if (!isPositive) throw new Error(`--${name} ${text}: not a positive number`);
  return value;
};
const objective: Objective =
  objectiveArg === "v1"
    ? OBJECTIVE_V1
    : {
        kind: "v2",
        gradeChange: v2Number("grade-change", OBJECTIVE_V2.gradeChange),
        reachM: {
          viaduct: v2Number("reach", OBJECTIVE_V2.reachM.viaduct),
          below: v2Number("reach-below", OBJECTIVE_V2.reachM.below),
        },
        targetScale: v2Number("target-scale", OBJECTIVE_V2.targetScale),
      };
// P2.7-6 PR 1: --structures height draws a viaduct-tagged run's stretches as viaduct, embankment or
// cut from its solved height (src/expressway/heightStructures.ts); tags (the default) as before.
const structuresArg = arg("structures") ?? "tags";
const isStructuresMode = structuresArg === "tags" || structuresArg === "height";
if (!isStructuresMode) throw new Error(`unknown --structures ${structuresArg} (tags, height)`);
const structuresMode = structuresArg as "tags" | "height";
// S6 PR 2: --ground compile compiles the runs at grade of a chain with a compiled run (needs --structures height).
const groundArg = arg("ground") ?? "skip";
const isGroundModeArg = groundArg === "skip" || groundArg === "compile";
if (!isGroundModeArg) throw new Error(`unknown --ground ${groundArg} (skip, compile)`);
const groundMode = groundArg as "skip" | "compile";
const isGroundWithoutHeight = groundMode === "compile" && structuresMode !== "height";
if (isGroundWithoutHeight) throw new Error("--ground compile needs --structures height");
// S6 PR 3: --touchdown all lets go the pairs of every class coming down to the same place; --companions on
// holds main lines running beside each other to one height at --companion-weight (1 by default).
const touchdownArg = arg("touchdown") ?? "mains";
const isTouchdownArg = touchdownArg === "mains" || touchdownArg === "all";
if (!isTouchdownArg) throw new Error(`unknown --touchdown ${touchdownArg} (mains, all)`);
const touchdownMode = touchdownArg as "mains" | "all";
const companionsArg = arg("companions") ?? "off";
const isCompanionsArg = companionsArg === "off" || companionsArg === "on";
if (!isCompanionsArg) throw new Error(`unknown --companions ${companionsArg} (off, on)`);
const companionWeight = Number(arg("companion-weight") ?? "1");
const isWeightBad = !(companionWeight > 0);
if (isWeightBad) throw new Error(`--companion-weight must be > 0`);
const isCompanions = companionsArg === "on";
const isCompanionsInBlocks = isCompanions && partitionMode === "blocks";
if (isCompanionsInBlocks) throw new Error("--companions on needs --partition components");
// --below all (P2.7-1), blocks (P2.7-2), v1, a sweep of the v2 weights and the structures by height
// (P2.7-6) move the decks: measuring only, never into the shipped folder.
const refusal = shippedFolderRefusal({
  hasOut: arg("out") !== undefined,
  isBelowAll: below === "all",
  isBlocks: partitionMode === "blocks",
  isV1: objective.kind === "v1",
  v2Flags,
  isHeight: structuresMode === "height",
  isGround: groundMode === "compile",
  isTouchdownAll: touchdownMode === "all",
  isCompanions,
});
if (refusal) throw new Error(refusal);
const stagesMs: Record<string, number> = {};
let stageStarted = performance.now();
/** Time since the last stage ended, booked to `name` (the scorecard's stagesMs). */
const endStage = (name: string) => {
  const now = performance.now();
  stagesMs[name] = now - stageStarted;
  stageStarted = now;
};

// 0. Structures: the deck levels the landmark build wrote. Without them the bridge is compiled as an
// ordinary viaduct (warned), never pinned to numbers that do not parse.
const LANDMARKS = join(import.meta.dirname, "..", "public", "data", "landmarks.json");
const landmarkEntries = JSON.parse(await readFile(LANDMARKS, "utf8")) as Array<{
  id: string;
  deckLevels?: unknown;
}>;
const structures: Structure[] = [];
// --no-structures builds without them (to compare a bridge pinned to its levels with the plain viaduct).
const useStructures = !process.argv.includes("--no-structures");
for (const spec of useStructures ? STRUCTURE_SPECS : []) {
  const entry = landmarkEntries.find((e) => e.id === spec.landmark);
  const levels = entry ? deckLevelsOf(entry) : null;
  if (!levels) {
    warn("expressway_structure_missing", { landmarkId: spec.landmark, hasEntry: entry !== undefined });
    continue;
  }
  structures.push(structureFrom(spec, levels));
}
const OUT = arg("out") ?? OUT_DEFAULT;
const acceptExtract = process.argv.includes("--accept-extract");
const file = await extract(arg("pbf"), acceptExtract);
const timestamp = readReplicationTimestamp(file);
const sha256 = sha256Of(file);
const extractCheck = checkExtract(timestamp, acceptExtract, sha256);
log("expressway_extract_checked", {
  timestamp,
  expected: EXPECTED_EXTRACT_TIMESTAMP,
  sha256,
  pinned: timestamp === EXPECTED_EXTRACT_TIMESTAMP && sha256 === EXPECTED_EXTRACT_SHA256,
  accepted: acceptExtract,
});
if (!extractCheck.ok) throw new Error(extractCheck.reason);
endStage("extract");

// 1. Motorways of the region, and those of the universe.
const isMotorway = (t: Record<string, string>) => t.highway === "motorway" || t.highway === "motorway_link";
const allWays = readWays(file, isMotorway);
const coords = readNodeCoords(file, new Set(allWays.flatMap((w) => w.refs)));
const junctionTags = new Map(
  readTaggedNodes(file, (t) => t.highway === "motorway_junction").map((n) => [n.id, n.tags]),
);
// 非常電話 and 非常駐車帯 for 116の4・116の6 (G6): OSM's emergency=phone nodes, and the bays where
// OSM maps them (highway=emergency_bay, or emergency=emergency_bay).
const isBay = (t: Record<string, string>) => t.highway === "emergency_bay" || t.emergency === "emergency_bay";
const phoneOrBay = readTaggedNodes(file, (t) => t.emergency === "phone" || isBay(t)).filter((n) =>
  inBox(UNIVERSE, n.lon, n.lat),
);
const universe = allWays.filter((w) =>
  w.refs.some((r) => {
    const c = coords.get(r);
    return c !== undefined && inBox(UNIVERSE, c[0], c[1]);
  }),
);
const universeIds = new Set(universe.map((w) => w.id));
const nodes = new Map<number, XwNode>();
const ways = new Map<number, XwWay>();
for (const w of universe) {
  const hasAllCoords = w.refs.every((r) => coords.has(r));
  if (!hasAllCoords || w.refs.length < 2) continue;
  ways.set(w.id, normalizeWay(w.id, w.refs, w.tags));
  for (const r of w.refs) {
    const [lon, lat] = coords.get(r)!;
    nodes.set(r, normalizeNode(r, lon, lat, junctionTags.get(r) ?? {}));
  }
}
// A chain that leaves the universe ends where its way continues outside: that end is left free.
const outsideNodes = new Set<number>();
for (const w of allWays) {
  if (universeIds.has(w.id)) continue;
  for (const r of [w.refs[0], w.refs[w.refs.length - 1]]) if (nodes.has(r)) outsideNodes.add(r);
}
// The streets a structure names (its lower floor): read by id, compiled as `street` decks.
const streetIds = new Set(structures.flatMap((st) => st.streetWays));
const streetWays = streetIds.size > 0 ? readWaysById(file, streetIds) : [];
const missingStreets = [...streetIds].filter((id) => !streetWays.some((w) => w.id === id));
if (missingStreets.length > 0)
  throw new Error(`structure street ways not in the extract: ${missingStreets.join(", ")}`);
const streetCoords = readNodeCoords(file, new Set(streetWays.flatMap((w) => w.refs)));
for (const w of streetWays) {
  ways.set(w.id, normalizeStreetWay(w.id, w.refs, w.tags));
  for (const r of w.refs) {
    const [lon, lat] = streetCoords.get(r)!;
    nodes.set(r, nodes.get(r) ?? normalizeNode(r, lon, lat, {}));
  }
}
const net: Network = { ways, nodes };
log("expressway_osm_read", {
  ways: allWays.length,
  universeWays: ways.size,
  nodes: nodes.size,
  junctions: [...nodes.values()].filter((n) => n.junctionName !== null || n.junctionRef !== null).length,
});

endStage("osm");

// 2. Plan alignment and what the range depends on. --range ship picks the runs by scope.ts from
// the whole plan; the 23 wards are the e-Stat town polygons the game uses (public/data/areas.json).
const isShip = scope === "ship";
const hasWards = isShip || reportPath !== undefined;
const areas = hasWards
  ? new AreaIndex(
      JSON.parse(
        await readFile(join(import.meta.dirname, "..", "public", "data", "areas.json"), "utf8"),
      ) as AreaFile,
    )
  : null;
const inWards = (lon: number, lat: number) => areas?.lookup(lat, lon) != null;
const plan = planNetwork(net, outsideNodes, ranges, structures, {
  pruneBelow: below === "pruned",
  partition: partitionMode,
  quietFactor,
  structures: structuresMode,
  ground: groundMode,
  touchdown: touchdownMode,
  ...(isCompanions ? { companionWeight } : {}),
  ...(isShip ? { wanted: (p) => shipRuns(p, inWards).all } : {}),
});
// Asked again of the finished plan (the same set: shipRuns is pure), for the log and the scorecard.
const chosenShip = isShip ? shipRuns(plan, inWards) : null;
if (chosenShip !== null) {
  log("expressway_scope_chosen", {
    main: chosenShip.main.size,
    ramps: chosenShip.ramps.size,
    belowRuns: [...chosenShip.all].filter((id) => plan.runs.get(id)!.below).length,
    prunedBelow: below === "pruned",
  });
}
const part = plan.partition;
if (part) {
  log("expressway_blocks_planned", {
    quietFactor: part.quietFactor,
    quietMinM: part.quietMinM,
    anchors: part.anchors.length,
    pieces: part.pieces.runs.size,
    blocks: part.pieces.components.size,
    neededBlocks: part.neededBlocks.length,
    routeGroups: part.routeGroups.length,
    neededRuns: part.neededRuns.length,
  });
}
const untied = untiedPairs(plan);
log("expressway_planned", {
  chains: plan.chains.size,
  runs: plan.runs.size,
  wanted: plan.wanted.size,
  needed: plan.needed.length,
  crossings: plan.crossings.length,
  belowRuns: [...plan.runs.values()].filter((r) => r.below).length,
  belowDeferred: plan.belowDeferred.length,
  untiedStations: plan.pairs.filter((p) => p.untied).length,
  untiedStationsNeeded: untied.reduce((n, p) => n + p.stations, 0),
});
endStage("plan");

// 3. The ground under the needed runs.
const dem = new BuildDem();
const points = groundPoints(plan);
const demTiles = await dem.prefetch(points);
log("expressway_dem_ready", { tiles: demTiles, fetched: dem.fetched });
endStage("dem");

// 4. Roads and railways at ground level under the needed runs (z16 cells around their stations).
const cellKey = (lon: number, lat: number) => tileKey(lon, lat, 16);
const cells = new Set<string>();
for (const [lon, lat] of points) {
  for (const [dx, dy] of [
    [0, 0],
    [0.004, 0],
    [-0.004, 0],
    [0, 0.0035],
    [0, -0.0035],
  ])
    cells.add(cellKey(lon + dx, lat + dy));
}
const nearCoords = readNodeCoordsWhere(file, (lon, lat) => cells.has(cellKey(lon, lat)));
const isAtGround = (t: Record<string, string>) =>
  (t.bridge ?? "no") === "no" &&
  (t.tunnel ?? "no") === "no" &&
  (Number.parseInt(t.layer ?? "0", 10) || 0) === 0;
const ROAD = /^(trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$/;
const RAIL = /^(rail|light_rail|subway|narrow_gauge|tram)$/;
const isCrossed = (t: Record<string, string>) =>
  isAtGround(t) && (ROAD.test(t.highway ?? "") || RAIL.test(t.railway ?? ""));
const crossWays = readWays(file, isCrossed, (refs) => refs.some((r) => nearCoords.has(r)));
const missing = new Set(crossWays.flatMap((w) => w.refs).filter((r) => !nearCoords.has(r)));
const farCoords = missing.size > 0 ? readNodeCoords(file, missing) : new Map<number, [number, number]>();
const objects: CrossObject[] = crossWays
  .map((w) => ({
    kind: (RAIL.test(w.tags.railway ?? "") ? "rail" : "road") as CrossObject["kind"],
    id: w.id,
    pts: w.refs.map((r) => nearCoords.get(r) ?? farCoords.get(r)).filter((c): c is [number, number] => !!c),
  }))
  .filter((o) => o.pts.length >= 2)
  .sort((a, b) => a.id - b.id);
log("expressway_objects_read", {
  roads: objects.filter((o) => o.kind === "road").length,
  rails: objects.filter((o) => o.kind === "rail").length,
});
endStage("objects");

// 5. Solve and write.
const solveStarted = performance.now();
log("expressway_objective_chosen", {
  objective: objective.kind,
  gradeChange: objective.kind === "v2" ? objective.gradeChange : null,
  reachM: objective.kind === "v2" ? objective.reachM.viaduct : null,
  reachBelowM: objective.kind === "v2" ? objective.reachM.below : null,
  targetScale: objective.kind === "v2" ? objective.targetScale : null,
});
const result = solvePlan(plan, (lon, lat) => dem.heightAt(lon, lat), objects, { objective });
log("expressway_solved", {
  ...result.stats,
  qpMs: Math.round(result.stats.qpMs),
  durationS: Math.round((performance.now() - solveStarted) / 100) / 10,
});
endStage("solve");
// 6. Signs (G6): where each stands on the decks and what it says; the entrances for 103・104.
const signPlan = planSigns({
  chunks: result.chunks,
  runs: result.runs,
  features: result.features,
  net,
  phones: phoneOrBay
    .filter((n) => n.tags.emergency === "phone")
    .map(({ id, lon, lat }) => ({ id, lon, lat })),
  bays: phoneOrBay.filter((n) => isBay(n.tags)).map(({ id, lon, lat }) => ({ id, lon, lat })),
});
for (const chunk of result.chunks) {
  const signs = signPlan.signs.get(chunk.id);
  if (signs) chunk.signs = signs;
  const posted = signPlan.posted.get(chunk.id);
  if (posted !== undefined) chunk.posted = posted;
}
const signCounts: Record<string, number> = {};
for (const list of signPlan.signs.values())
  for (const sign of list) signCounts[sign.id] = (signCounts[sign.id] ?? 0) + 1;
log("expressway_signs_planned", {
  signs: [...signPlan.signs.values()].reduce((n, l) => n + l.length, 0),
  byId: signCounts,
  entrances: signPlan.entrances.length,
  unplaced: signPlan.unplaced.length,
});
for (const u of signPlan.unplaced) warn("expressway_sign_unplaced", u);
endStage("signs");
const tiles = packTiles(result.chunks, result.runs, signPlan.entrances, Z);
// The ledger (P2.7-4) mixes what the tool counts with what a review decided: a rebuild must not
// lose it, so it is read before the folder is cleared and written back right after.
const keptLedger = await readFile(join(OUT, "ledger.json"), "utf8").catch(() => null);
// Whether a departure is accepted (P2.7-4 5.8): the rules, or the folder's ledger (--ledger: another
// folder's, e.g. the default data's for a measuring build) where it decided the case within its cap.
const ledgerPath = arg("ledger");
const ledgerText = ledgerPath ? await readFile(ledgerPath, "utf8") : keptLedger;
const ledger = ledgerText === null ? null : (JSON.parse(ledgerText) as Ledger);
const caseContext = caseContextOf(result.runs, untied, result.chunks);
const verdict = ledgerVerdict(caseContext, ledger);
for (const d of result.diagnostics) d.allowed = isAllowed(d, verdict);
log("expressway_ledger_read", {
  file: ledgerPath ?? (keptLedger === null ? null : join(OUT, "ledger.json")),
  cases: ledger?.cases.length ?? 0,
  allowed: result.diagnostics.filter((d) => d.allowed && plan.needed.includes(d.run)).length,
  notAllowed: result.diagnostics.filter((d) => !d.allowed && plan.needed.includes(d.run)).length,
});
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
// Back at once, before anything else is written: a build that fails half-way must not lose it.
if (keptLedger !== null) await writeFile(join(OUT, "ledger.json"), keptLedger);
let bytes = 0;
const tileKeys = [...tiles.keys()];
const tileSizes: Array<{ bytes: number; gzipBytes: number }> = [];
for (const key of tileKeys) {
  const tile = tiles.get(key)!;
  const text = JSON.stringify(tile);
  const size = Buffer.byteLength(text);
  bytes += size;
  // Why gzip only with --report: the scorecard's budget is the size served compressed, and the
  // default build, which writes no report, need not spend the time.
  tileSizes.push({ bytes: size, gzipBytes: reportPath ? gzipSync(text).length : 0 });
  await writeFile(join(OUT, `${key}.json`), text);
}
const UNSOLVED = [
  "vertical_unsolved",
  "parent_unsolved",
  "parent_missing",
  "dependency_cycle",
  "partner_unsolved",
];
const isUnsolved = (kind: string) => UNSOLVED.includes(kind);
const meta: XwMeta = {
  version: XW_VERSION,
  // The structures by height only in a height build: the tags' files name "below" alone, as before.
  features: XW_FEATURES.filter((f) => f !== "height-structures" || structuresMode === "height"),
  zoom: Z,
  tiles: tileKeys,
  ranges: rangeNames.map((name) => ({ name, ...RANGES[name] })),
  ...(isShip ? { scope: "ship" as const } : {}),
  structures: structures.map((st) => ({
    id: st.id,
    version: DECK_LEVELS_VERSION,
    decks: st.decks.map((d) => d.id),
  })),
  extract: { url: OSM_EXTRACT, timestamp },
  counts: {
    runs: result.runs.length,
    chunks: result.chunks.length,
    stations: result.chunks.reduce((n, c) => n + c.st.length / STATION_STRIDE, 0),
    piers: result.chunks.reduce((n, c) => n + c.piers.length / PIER_STRIDE, 0),
    crossings: result.chunks.reduce((n, c) => n + c.cross.length / CROSS_STRIDE, 0),
  },
  bytes,
};
const metaText = JSON.stringify(meta);
await writeFile(join(OUT, "meta.json"), metaText);
const record: XwBuildRecord = {
  version: XW_RECORD_VERSION,
  objective: objective.kind,
  solver: {
    components: result.stats.components,
    solves: result.stats.solves,
    unconverged: result.stats.unconverged,
    // Only when a solve was retried: a build with none keeps report.json byte for byte as before.
    ...(result.stats.retried > 0 ? { retried: result.stats.retried } : {}),
  },
  runs: result.runs,
  closed: result.closed,
  diagnostics: result.diagnostics.filter((d) => plan.needed.includes(d.run)),
  untied: untied.map(({ a, b, stations }) => ({ a, b, stations })),
  blocks: blockRecords(result.partition.blocks, result.chunks),
};
const recordText = JSON.stringify(record);
await writeFile(join(OUT, "report.json"), recordText);
await writeFile(
  join(OUT, "LICENSE.txt"),
  `Expressway centrelines, lanes, ref and entrance/exit names in this folder are extracted from
OpenStreetMap and altered (smoothed and resampled).
© OpenStreetMap contributors — https://www.openstreetmap.org/copyright
This database, including the road surface elevations, is made available under the Open Database
License (ODbL) 1.0: https://opendatacommons.org/licenses/odbl/1-0/
Source extract: ${OSM_EXTRACT} (Geofabrik), replication timestamp ${timestamp ?? "unknown"}.
Filters: way["highway"~"^(motorway|motorway_link)$"] within ${JSON.stringify(UNIVERSE)}, and the
node["highway"="motorway_junction"] on them (name, name:en, ref), node["emergency"="phone"] /
emergency bays beside them (placed as the signs 116の4・116の6), and the street ways a structure
names (src/expressway/structures.ts: way ${[...streetIds].sort((a, b) => a - b).join(", ")}, the
Rainbow Bridge's lower floor and its approaches). The operator's name is stripped off route names
and anything still naming it is dropped. Roads and railways at ground level under the viaducts (way["highway"] / way["railway"]
without bridge, tunnel or layer) are read as clearance constraints only and are not in this folder.
Method: scripts/expressway.ts (plan smoothing within 1.5 m of the OSM line, vertical alignment
within 道路構造令, chunks of at most 300 m).
Elevations: 地理院タイル（標高タイル（基盤地図情報数値標高モデル））を加工して作成
(https://maps.gsi.go.jp/development/ichiran.html). They are a vertical alignment designed by this
project with the ground elevation as a constraint — estimates, not surveyed values and not a
product of GSI. The files also carry the ground elevation under each station and pier (the last
value of a station, the second of a pier): 地理院の標高タイルを平滑化（5×5 中央値と 3×3 の重み付き平均）
した値を加工して含む — processed (smoothed) GSI elevation-tile values, offered under the same ODbL,
used by the game to stop girders and piers at the ground.
Files: <x>-<y>.json are z14 tiles (the chunks, the summaries of their runs, the entrances whose
street end lies in the tile); meta.json is the index of the tiles. report.json is the build's record
(the full run summaries, the diagnostics, the closed runs, the solver's counts and a SHA-256 of each
solved block's chunks) and ledger.json the project's ledger of accepted departures (each case counted
from these files, with the review's decision and reason): both are derived from the same data, under
the same licence, for the project's tests and tools; the game reads neither.
`,
);
for (const d of record.diagnostics) warn("expressway_diagnostic", d);
for (const r of record.runs) {
  if (!r.structure) continue;
  const { deck, osmM, planM, zM } = r.structure;
  log("expressway_structure_built", { deck, run: r.id, osmM, planM, zM });
}
log("expressway_written", {
  range: rangeArg,
  tiles: tileKeys.length,
  runs: result.runs.length,
  chunks: result.chunks.length,
  stations: meta.counts.stations,
  bytes,
  diagnostics: record.diagnostics.length,
  unsolved: record.diagnostics.filter((d) => isUnsolved(d.kind)).length,
  closedMain: result.closed.filter((c) => c.cls === "expressway").length,
  closedRamps: result.closed.filter((c) => c.cls === "ramp").length,
  durationS: Math.round((performance.now() - started) / 100) / 10,
});
endStage("write");

/** A written run's surface at run distance s (the chunk holding s), or null when not written. */
let chunksByRun: Map<string, typeof result.chunks> | null = null;
function zOf(run: string, s: number): number | null {
  if (chunksByRun === null) {
    chunksByRun = new Map();
    for (const c of result.chunks) chunksByRun.set(c.run, [...(chunksByRun.get(c.run) ?? []), c]);
  }
  const list = chunksByRun.get(run) ?? [];
  const c = list.find((k) => s >= k.st[0] - 1e-6 && s <= k.st[k.st.length - STATION_STRIDE] + 1e-6);
  return c ? surfaceAt(c.st, s).z : null;
}

/** The reach of the band's centre about an open end (compile.ts setupGround's movingMedian, ±150 m). */
const OPEN_END_REACH_M = 150;

/**
 * The ends of the runs at grade that a viaduct or below run seams onto (`open`, S6 PR 3): how far the
 * road stands off the band's centre there, past the band, and the worst.
 */
function openEndsOf(groundRuns: typeof result.runs): NonNullable<NonNullable<Report["ground"]>["openEnds"]> {
  const band = HEIGHT_STRUCTURES.value.ground.bandM;
  const offs: number[] = [];
  for (const r of groundRuns) {
    const list = result.chunks.filter((c) => c.run === r.id).sort((a, b) => a.k - b.k);
    const isEmpty = list.length === 0;
    if (isEmpty) continue;
    // Off the band's centre (the ground's moving median, ±150 m as setupGround's), not the DEM at the
    // end alone (PR 3 review): the stations' ground within that reach of the end.
    const stations: Array<{ s: number; z: number; g: number }> = [];
    for (const c of list)
      for (let i = 0; i < c.st.length; i += STATION_STRIDE)
        stations.push({ s: c.st[i], z: c.st[i + 3], g: c.st[i + 5] });
    const L = stations[stations.length - 1].s;
    const offAt = (atStart: boolean) => {
      const end = atStart ? stations[0] : stations[stations.length - 1];
      const near = stations
        .filter((p) => (atStart ? p.s : L - p.s) <= OPEN_END_REACH_M)
        .map((p) => p.g)
        .sort((a, b) => a - b);
      const m = near.length >> 1;
      const median = near.length % 2 === 1 ? near[m] : (near[m - 1] + near[m]) / 2;
      return Math.abs(end.z - median);
    };
    if (r.start.kind === "open") offs.push(offAt(true));
    if (r.end.kind === "open") offs.push(offAt(false));
  }
  return {
    count: offs.length,
    overBand: offs.filter((d) => d > band + 1e-9).length,
    maxM: Math.round(Math.max(0, ...offs) * 100) / 100,
  };
}

/** The companions' station pairs on runs written both (the ones the scorecard measures). */
function companionPairsWritten(): NonNullable<typeof plan.companions>["list"] {
  return plan.companions!.list.filter((c) => zOf(c.a, c.sa) !== null && zOf(c.b, c.sb) !== null);
}

/**
 * The scorecard's `companions` (S6 PR 3): the station pairs among the written runs and |Δz| there as
 * solved, all of them and those with a row.
 */
function companionsSummary(): NonNullable<Report["companions"]> {
  const { weight } = plan.companions!;
  const step = COMPANIONS.value.stepM;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  // Every station pair beside each other, and those with a row (the tapered ends have none): the bar
  // (p90 ≤ 0.5 m) is the whole's (PR 3 re-review N1: the held ones alone read 0.29 m, the whole 0.55 m).
  const tally = (list: ReturnType<typeof companionPairsWritten>) => {
    const dz = list.map((c) => Math.abs(zOf(c.a, c.sa)! - zOf(c.b, c.sb)!)).sort((a, b) => a - b);
    const at = (q: number) =>
      dz.length === 0 ? 0 : dz[Math.min(dz.length - 1, Math.ceil(q * dz.length) - 1)];
    return {
      pairs: new Set(list.map((c) => `${c.a}|${c.b}`)).size,
      stations: dz.length,
      km: Math.round(((dz.length * step) / 1000) * 1000) / 1000,
      dz: {
        p50M: r2(at(0.5)),
        p90M: r2(at(0.9)),
        maxM: r2(dz[dz.length - 1] ?? 0),
        overDz: dz.filter((d) => d > COMPANIONS.value.dzM + 1e-9).length,
      },
    };
  };
  const all = companionPairsWritten();
  return { weight, ...tally(all), held: tally(all.filter((c) => c.held !== false)) };
}

/**
 * The scorecard's `ground` (any height build, skip or compile, so the holes compare): the runs at grade
 * written, the main line's holes, the roads blocked across them, how far they stand off the ground, and
 * how their main lines follow it (trackingOf over them alone).
 */
function groundSummary(): NonNullable<Report["ground"]> {
  const groundRuns = result.runs.filter((r) => r.ground === true);
  const ids = new Set(groundRuns.map((r) => r.id));
  const written = new Set(result.runs.map((r) => r.id));
  const tracked = trackingOf(
    result.chunks.filter((c) => ids.has(c.run)),
    groundRuns,
    "ground",
  );
  const blocked = result.diagnostics.filter(
    (d) =>
      ids.has(d.run) && d.kind === "crossing_over_or_at_grade" && /crosses the road at grade/.test(d.detail),
  );
  // Crossed on the run, not at its end node (most are a street at a ramp's end, where it meets the
  // street network): those the game must carry over or under (PR 7).
  const isMiddle = (d: (typeof blocked)[number]) => {
    const r = groundRuns.find((x) => x.id === d.run)!;
    const s = Number(/ at ([\d.]+) m/.exec(d.detail)?.[1] ?? 0);
    return s > 1 && r.lengthM - s > 1;
  };
  const off: number[] = [];
  let over3 = 0;
  for (const r of groundRuns) {
    let worst = 0;
    for (const c of result.chunks.filter((k) => k.run === r.id))
      for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
        const d = Math.abs(c.st[i + 3] - c.st[i + 5]);
        off.push(d);
        worst = Math.max(worst, d);
      }
    if (worst > 3) over3++;
  }
  off.sort((a, b) => a - b);
  const p95 = off.length > 0 ? off[Math.min(off.length - 1, Math.ceil(0.95 * off.length) - 1)] : 0;
  return {
    runs: groundRuns.length,
    km: Math.round(groundRuns.reduce((n, r) => n + r.lengthM, 0)) / 1000,
    ...mainLineHoles(plan, written),
    crossingsBlocked: blocked.length,
    crossingsBlockedMiddle: blocked.filter(isMiddle).length,
    betweenTunnels: [...(plan.betweenTunnels ?? [])].sort(),
    offGround: {
      p95M: Math.round(p95 * 100) / 100,
      maxM: Math.round((off[off.length - 1] ?? 0) * 100) / 100,
      over3mRuns: over3,
    },
    openEnds: openEndsOf(groundRuns),
    tracking: {
      runs: tracked.runs,
      km: tracked.km,
      correlation: tracked.correlation,
      shortWaveCorrelation: tracked.shortWaveCorrelation,
      shortWaveStdM: tracked.shortWaveStdM,
      reversalsPerKm: tracked.reversalsPerKm,
    },
  };
}

/**
 * Every planned run's district (districts.ts): a written run from its chunks and ends, one not
 * written from the plan's ref and line (no parents: a closed ramp falls to the nearest main line).
 */
function plannedDistricts(): Map<string, District> {
  const byRun = new Map<string, XwChunk[]>();
  for (const c of result.chunks) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c]);
  const written = districtRunsOf(result.runs, byRun);
  const isWritten = new Set(written.map((r) => r.id));
  const unwritten = plan.needed
    .filter((id) => !isWritten.has(id))
    .map((id) => {
      const rp = plan.runs.get(id)!;
      const points: Array<[number, number]> = [];
      for (let i = 0; i < rp.align.xy.length; i += 2 * 50)
        points.push(rp.plane.toLonLat(rp.align.xy[i], rp.align.xy[i + 1]));
      return { id, cls: rp.cls, ref: rp.ref, parents: [], points };
    });
  return assignDistricts([...written, ...unwritten]);
}

// 7. The scorecard (P2.7-1): the runs the plan made for the range and the components it needs.
if (reportPath) {
  const planned: PlannedRun[] = plan.needed.map((id) => {
    const rp = plan.runs.get(id)!;
    return { id, cls: rp.cls, lengthM: rp.length, below: rp.below, wanted: plan.wanted.has(id) };
  });
  const byField = Object.fromEntries(
    Object.entries(meta).map(([k, v]) => [k, Buffer.byteLength(JSON.stringify(v) ?? "")]),
  );
  const lengthOf = (ids: Iterable<string>) => [...ids].reduce((n, id) => n + plan.runs.get(id)!.length, 0);
  const reportInput = {
    label: arg("label") ?? basename(OUT),
    range: rangeArg,
    below,
    objective,
    extract: {
      url: OSM_EXTRACT,
      timestamp,
      expected: EXPECTED_EXTRACT_TIMESTAMP,
      accepted: acceptExtract,
      sha256,
    },
    plan: {
      chains: plan.chains.size,
      runs: plan.runs.size,
      components: plan.components.size,
      belowRuns: [...plan.runs.values()].filter((r) => r.below).length,
      belowDeferred: plan.belowDeferred.length,
      untied: { stations: untied.reduce((n, p) => n + p.stations, 0), pairs: untied },
    },
    planned,
    extent: scopeExtent(plan, plan.wanted, inWards),
    rampsOutside: chosenShip
      ? {
          runs: chosenShip.rampsOutside.size,
          km: Math.round(lengthOf(chosenShip.rampsOutside)) / 1000,
        }
      : null,
    violations: violationsOf(record, result.chunks, rampFloorOf(ledger), structuresMode === "height"),
    structureDecks: meta.structures.flatMap((st) => st.decks),
    runs: result.runs,
    closed: result.closed,
    diagnostics: result.diagnostics,
    chunks: result.chunks,
    tiles: tileSizes,
    meta: { raw: Buffer.byteLength(metaText), gzip: gzipSync(metaText).length, byField },
    record: sizeOf(recordText),
    ledger: keptLedger === null ? null : sizeOf(keptLedger),
    solver: {
      components: result.stats.components,
      largestRuns: result.stats.largestRuns,
      largestVariables: result.stats.largestVariables,
      solves: result.stats.solves,
      iterations: result.stats.iterations,
      unconverged: result.stats.unconverged,
      retried: result.stats.retried,
      qpMs: result.stats.qpMs,
    },
    partition: {
      ...result.partition,
      blocks: result.partition.blocks.map(({ canonical, members: _members, ...b }) => ({
        ...b,
        hash: sha256Of(new TextEncoder().encode(canonical)),
      })),
    },
    stagesMs,
    districts: plannedDistricts(),
    ledgerSummary: ledger?.summary ?? null,
    heightStructures: structuresMode === "height",
    // With the structures by height, skip or compile, so the holes compare; tags builds as before.
    ground: structuresMode === "height" ? groundSummary() : null,
    companions: plan.companions ? companionsSummary() : null,
  };
  const report = buildReport(reportInput);
  await mkdir(dirname(reportPath), { recursive: true });
  const reportText = JSON.stringify(report, null, 1) + "\n";
  await writeFile(reportPath, reportText);
  // The companions' station pairs (about 120 KB in ship) beside the scorecard, not in it (PR 3 review).
  if (plan.companions) {
    const pairs = companionPairsWritten().map((c) => [c.a, c.sa, c.b, c.sb, c.held === false ? 0 : 1]);
    await writeFile(
      reportPath.replace(/(\.report)?\.json$/, "") + ".companions.json",
      JSON.stringify(pairs) + "\n",
    );
  }
  if (baselinePath) {
    await mkdir(dirname(baselinePath), { recursive: true });
    const baseline = buildReport({ ...reportInput, withoutTimings: true });
    await writeFile(baselinePath, JSON.stringify(baseline, null, 1) + "\n");
  }
  const plannedTally = report.runs.planned;
  log("expressway_report_written", {
    file: reportPath,
    plannedRuns: plannedTally.main.runs + plannedTally.ramp.runs + plannedTally.street.runs,
    writtenRuns: result.runs.length,
    closedRuns: result.closed.length,
    unconverged: result.stats.unconverged,
    retried: result.stats.retried,
    bytes: Buffer.byteLength(reportText),
  });
}
