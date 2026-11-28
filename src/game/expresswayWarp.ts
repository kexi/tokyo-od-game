import type { Vector3 } from "three";
import {
  ST,
  STATION_STRIDE,
  type XwChunk,
  type XwMeta,
  type XwTile,
  type XwTileRun,
} from "../expressway/format";
import { haversine } from "../expressway/geo";
import { isSupportedMeta } from "../world/expresswayDeck";
import { routeName } from "./roadNames";
import { laneCentreOffset } from "../world/laneChange";
import { leftOf, type RoadGraph, type Segment } from "../world/roads";

/**
 * 移動 to the expressway (?expressway): the named places of the published decks as warp spots,
 * each anchored on a deck (a main line where there is one), and where on that deck a car is put.
 *
 * The names are only the facilities' own names in the data (OSM `name` of a ramp, the entrance's
 * name with 入口, a route's name), each through the name layer (roadNames.ts routeName: an
 * operator's name before it is taken off, a name still naming one is dropped), never an
 * operator's name or mark (AGENTS.md).
 */
export type XwWarpSpot = {
  /** 「汐留入口」「芝公園出口」「都心環状線」. */
  name: string;
  role: "entrance" | "exit" | "route";
  /** The chunk (`<run>:<k>`) the car is put on: the main line at the ramp's 分合流 where it has one. */
  xid: string;
  /** The point on that chunk's centreline (its station nearest the anchor). */
  lat: number;
  lon: number;
};

/** How far a ramp's parent chain is followed up to a main line (a ramp branching off a ramp). */
const MAX_PARENT_HOPS = 3;
/**
 * How far from a ramp's open main-side end a main line is taken as the one it would meet (the
 * published ends lie 11–57 m from one). Why not any distance: a ramp far from every main line
 * would send the car to another road than the one named.
 */
const OPEN_END_REACH_M = 100;

type Station = { chunk: XwChunk; s: number; lon: number; lat: number };

/** Metres between two points. */
function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return haversine(a.lon, a.lat, b.lon, b.lat);
}

function stationsOf(chunk: XwChunk): Station[] {
  const st = chunk.st;
  const out: Station[] = [];
  for (let i = 0; i + STATION_STRIDE <= st.length; i += STATION_STRIDE)
    out.push({ chunk, s: st[i + ST.s], lon: st[i + ST.lon], lat: st[i + ST.lat] });
  return out;
}

/**
 * The warp spots of the tiles: one per name, the entrances and exits first (in the tiles' order),
 * then the routes. A ramp with no name and an entrance with a null name give none: no name is
 * made up for them.
 */
export function expresswaySpots(tiles: readonly XwTile[]): XwWarpSpot[] {
  const chunksByRun = new Map<string, XwChunk[]>();
  const runs = new Map<string, XwTileRun>();
  const entranceNames = new Map<string, string>();
  for (const tile of tiles) {
    for (const r of tile.runs) if (!runs.has(r.id)) runs.set(r.id, r);
    for (const c of tile.chunks) {
      const list = chunksByRun.get(c.run) ?? [];
      const isNew = !list.some((x) => x.id === c.id);
      if (isNew) list.push(c);
      chunksByRun.set(c.run, list);
    }
    for (const e of tile.entrances ?? []) {
      const name = e.name ? routeName(`${e.name}入口`) : null;
      if (name) entranceNames.set(e.run, name);
    }
  }
  for (const list of chunksByRun.values()) list.sort((a, b) => a.k - b.k);

  /** The station of `run` nearest its own distance `s` (a run's s counts on across its chunks). */
  const stationAt = (run: string, s: number): Station | null => {
    const all = (chunksByRun.get(run) ?? []).flatMap(stationsOf);
    if (all.length === 0) return null;
    return all.reduce((best, x) => (Math.abs(x.s - s) < Math.abs(best.s - s) ? x : best));
  };
  const middleOf = (run: string): Station | null => {
    const all = (chunksByRun.get(run) ?? []).flatMap(stationsOf);
    return all.length === 0 ? null : all[Math.floor(all.length / 2)];
  };
  const mainStations = [...chunksByRun]
    .filter(([runId]) => runs.get(runId)?.cls === "expressway")
    .flatMap(([, list]) => list.flatMap(stationsOf));
  /** The main-line station nearest a ramp's station within OPEN_END_REACH_M, or null. */
  const nearestMain = (p: Station): Station | null => {
    let best: Station | null = null;
    let bestD = OPEN_END_REACH_M;
    for (const x of mainStations) {
      const d = metresBetween(p, x);
      const isNearer = d < bestD;
      if (!isNearer) continue;
      best = x;
      bestD = d;
    }
    return best;
  };
  /**
   * The main line a ramp leaves or joins: its junction end's parent; where that end is open (the
   * published range cuts the ramp before its 分合流: 汐留入口, 芝公園出入口), the main line nearest
   * that end; else the ramp's own middle.
   */
  const anchorOf = (run: XwTileRun, role: "entrance" | "exit"): Station | null => {
    let current = run;
    for (let hop = 0; hop < MAX_PARENT_HOPS; hop++) {
      const end = role === "exit" ? current.start : current.end;
      const isJunction = end.kind === "junction" && end.parent !== undefined && end.parentS !== undefined;
      if (!isJunction) break;
      const parent = runs.get(end.parent!);
      const at = stationAt(end.parent!, end.parentS!);
      if (!parent || !at) break;
      const isMain = parent.cls === "expressway";
      if (isMain) return at;
      current = parent;
    }
    const own = (chunksByRun.get(current.id) ?? []).flatMap(stationsOf);
    const mainSide = role === "exit" ? own[0] : own.at(-1);
    const near = mainSide ? nearestMain(mainSide) : null;
    return near ?? middleOf(current.id);
  };

  const spots: XwWarpSpot[] = [];
  const seen = new Set<string>();
  const add = (name: string, role: XwWarpSpot["role"], at: Station | null) => {
    const isTaken = seen.has(name) || at === null;
    if (isTaken) return;
    seen.add(name);
    spots.push({ name, role, xid: at.chunk.id, lat: at.lat, lon: at.lon });
  };
  for (const [runId, list] of chunksByRun) {
    const run = runs.get(runId);
    const isRamp = run?.cls === "ramp";
    if (!run || !isRamp) continue;
    const name = entranceNames.get(runId) ?? routeName(list.find((c) => c.name)?.name);
    if (!name) continue;
    // Why by the name and not by the ends: an 出口's start is its 分流 from the main line, an
    // 入口's end its 合流, and the name says which the facility is even where an end is open.
    const role = name.endsWith("出口") ? "exit" : "entrance";
    add(name, role, anchorOf(run, role));
  }
  // A route: the middle of its longest run in the data (the main line, not a ramp).
  const routeRuns = new Map<string, { run: string; n: number }>();
  for (const [runId, list] of chunksByRun) {
    const isMain = runs.get(runId)?.cls === "expressway";
    const name = routeName(list.find((c) => c.name)?.name);
    if (!isMain || !name) continue;
    const best = routeRuns.get(name);
    const isLonger = !best || list.length > best.n;
    if (isLonger) routeRuns.set(name, { run: runId, n: list.length });
  }
  for (const [name, { run }] of routeRuns) add(name, "route", middleOf(run));
  return spots;
}

/**
 * Every tile of the published decks, read without the decks' loader (ExpresswayDecks.loadTile
 * registers chunks, cuts the ground and tells the entrance listeners: the list needs none of it).
 * Null when there is no data, or data of a format the decks do not read.
 */
export async function fetchExpresswayTiles(
  base: string,
  get: typeof fetch = fetch,
): Promise<XwTile[] | null> {
  const meta = await get(`${base}data/expressway/meta.json`)
    .then((r) => (r.ok ? (r.json() as Promise<XwMeta>) : null))
    .catch(() => null);
  // Data the decks will not read (ExpresswayDecks.loadMeta): no decks, so no spots to land on.
  if (!meta || !isSupportedMeta(meta)) return null;
  const tiles = await Promise.all(
    meta.tiles.map((key) =>
      get(`${base}data/expressway/${key}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<XwTile>) : null))
        .catch(() => null),
    ),
  );
  return tiles.filter((t) => t !== null);
}

/**
 * Where on chunk `xid` a car is put for a spot at local point `p`: the graph's segment of that
 * chunk (a chunk can be cut into several at nodes) nearest p, kept 2 m off its ends. Null while
 * the graph has none of it that `accept` takes (not built yet, or no collider).
 */
export function deckLanding(
  graph: Pick<RoadGraph, "segments" | "nearestOn">,
  xid: string,
  p: Vector3,
  accept: (seg: Segment) => boolean,
): { seg: Segment; s: number } | null {
  let best: { seg: Segment; s: number; dist: number } | null = null;
  for (const seg of graph.segments) {
    const isChunk = seg.line.xid === xid && accept(seg);
    if (!isChunk) continue;
    const on = graph.nearestOn(seg, p);
    const isNearer = best === null || on.dist < best.dist;
    if (isNearer) best = { seg, s: on.s, dist: on.dist };
  }
  if (!best) return null;
  const s = Math.min(best.seg.length - 2, Math.max(2, best.s));
  return { seg: best.seg, s };
}

/**
 * A car on a deck at (seg, s) in lane `lane` (0: the left one), facing the way the chunk runs: the
 * point on the deck's surface (y is the surface, the caller adds the ride height) and the yaw.
 * Null where the surface is unknown. The one way of putting a car on a deck (main.ts placeOnStreet,
 * the 移動 to the expressway, debug.expressway.place).
 */
export function deckPose(
  graph: Pick<RoadGraph, "sample" | "surfaceY">,
  seg: Segment,
  s: number,
  lane = 0,
): { at: Vector3; yaw: number; surfaceY: number } | null {
  const { pos, dir } = graph.sample(seg, s);
  const y = graph.surfaceY(seg, s);
  if (y === null) return null;
  const at = pos.add(leftOf(dir, laneCentreOffset(seg, lane))).setY(y);
  return { at, yaw: Math.atan2(dir.x, dir.z), surfaceY: y };
}
