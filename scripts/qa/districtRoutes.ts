import type { District } from "../../src/expressway/districts.ts";
import type { XwFiles } from "../../src/expressway/files.ts";
import { ST, STATION_STRIDE, type XwChunk, type XwTileRun } from "../../src/expressway/format.ts";
import { type EndAnswer, endAhead, rangeOfChunks } from "../../src/world/expresswayEnds.ts";
import type { AutoRoute, CruiseRoute, DeckRoute, RunPlace, WallRoute } from "./deckRoutes.ts";
import type { StreetPlace } from "./streetPlaces.ts";

/**
 * A district's drives (P2.7 R1-5 PR B), generated from a data folder's runs: pure, the same table from
 * the same data (order and ids; no randomness). `just make-district-routes <dir> <district>` writes it
 * (not committed: the table is made again from R1-7's data); drive-deck.ts `--routes <file>` drives it.
 *
 * The routes (R1-5 3.2 and the user's decision of 2026-11-24, with C: entrance → main → exit chains):
 * - main: each main line (main or street-floor runs joined end to start, expresswayEnds.ts endAhead)
 *   end to end in lane 0, cut at its exits (each piece leaves by one) and at most every PIECE_M; the
 *   next piece starts up an entrance merging within CHAIN_NEAR_M before the cut (else OVERLAP_M before
 *   it). The ramps a piece drives in lane 0 need no lane-0 drive of their own (C).
 * - ramp: each ramp path (ramp runs joined end to start) in every lane it has, from APPROACH_M before
 *   its diverge on the run it leaves (or its own start) to APPROACH_M past its merge (or the street).
 * - lanes 1+ of the main lines: not driven (the user's decision): left to the probes and the views.
 * - wall: each run end with nothing going on (endAhead false), in each lane, at the posted limit.
 * - auto: AUTO_ROUTES entrance → exit pairs on the autopilot, picked by id order (every route ref
 *   first, then evenly through the rest).
 * - street places: each ramp's foot (a ground end), for street-drive.ts.
 * Runs the routes cannot reach are listed with a reason (`uncovered`).
 *
 * Why a line of runs and not the OSM chain (`chain`): a chain stops where OSM's way ids change, and
 * 44 of central's 129 main runs are a chain of their own; the game joins them by their ends.
 */

/** How far before a diverge and past a merge a ramp's route runs on the main line (m; R1-5 3.2). */
export const APPROACH_M = 300;
/** A cut piece starts this far before the previous one ended (m; R1-5 3.2). */
export const OVERLAP_M = 200;
/**
 * The longest main piece (m): 12 km is 12 min of game time at 60 km/h, half of a 25 min lock with
 * the page's moves (knowledge「P2.7 R1-5 PR A」手順 0), so a bundle holds a piece and its ramps.
 */
export const PIECE_M = 12_000;
/** An entrance or exit joins the line "near" its end within this (m): it takes the line's lane 0 (C). */
export const CHAIN_NEAR_M = 1_000;
/** How far before a run's dead end a wall route starts (m; R1-1b 7.3's 400 m). */
export const WALL_LEAD_M = 400;
/** How many autopilot routes (the plan's「地区ごとに 20 本」). */
export const AUTO_ROUTES = 20;
/**
 * How far (straight) an autopilot route's exit foot is from its entrance (m): about the hand table's
 * two (auto-shibakoen-shiodome 2,170 m and auto-shiodome-shibakoen 2,524 m driven), so a route is as
 * long as those that fit a bundle.
 */
export const AUTO_TRIP_M = 2_500;
/** A place is put this far inside its run's ends (m): at s0 itself chunkAt may answer the run before. */
const INSIDE_M = 2;
/** A cruise asks for more than any posted limit: the hook caps it at the posted limit (expresswayDrive.ts). */
const CRUISE_KMH = 100;
/** The posted limit where a chunk has none (km/h; the 都市高速's, as drive-deck.ts's wall routes). */
const DEFAULT_POSTED = 60;

export type DistrictTable = {
  district: string;
  routes: DeckRoute[];
  streetPlaces: StreetPlace[];
  /** Written runs of the district no route drives, and why. */
  uncovered: Array<{ run: string; why: string }>;
};

type Net = Pick<XwFiles, "runs" | "byRun" | "entrances" | "closed">;

type Run = {
  id: string;
  cls: XwTileRun["cls"];
  start: XwTileRun["start"];
  end: XwTileRun["end"];
  s0: number;
  s1: number;
};

/** Where the road goes on past a run's end: the next run and its run distance there, or why not. */
type Next = { run: string; s: number } | { stop: EndAnswer["why"] | "ground" };

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Game seconds over a run from s0 to s1 at each chunk's posted limit. */
function timeOn(chunks: readonly XwChunk[], s0: number, s1: number): number {
  let t = 0;
  for (const c of chunks) {
    const a = Math.max(s0, c.st[ST.s]);
    const b = Math.min(s1, c.st[c.st.length - STATION_STRIDE + ST.s]);
    const isOver = b > a;
    if (isOver) t += (b - a) / ((c.posted ?? DEFAULT_POSTED) / 3.6);
  }
  return t;
}

/**
 * An autopilot route's limit: AUTO_LIMIT `advance(1)` calls (drive-deck.ts driveAuto counts these,
 * about 2.9 s of real time each while the page draws, routeBundles.ts WALL_PER_ADVANCE_S), so one
 * that does not arrive still fits a bundle. The hand table's shortest (240); its routes of about
 * AUTO_TRIP_M arrive in about 200 s of game time. Why not 600 or a limit from the distance (the
 * first two): a route that did not arrive ran 18 min of a 25 min lock (the trial b5-a, 2026-11-28).
 */
export const AUTO_LIMIT = 240;

export function districtRoutes(
  net: Net,
  districts: ReadonlyMap<string, District>,
  district: string,
): DistrictTable {
  const tileRuns = new Map(net.runs.map((r) => [r.id, { id: r.id, cls: r.cls, start: r.start, end: r.end }]));
  const rangeOf = (id: string) => rangeOfChunks(net.byRun.get(id) ?? [], STATION_STRIDE);
  const runs = new Map<string, Run>();
  for (const r of [...net.runs].sort(byId)) {
    const isHere = districts.get(r.id) === district && net.byRun.has(r.id);
    if (!isHere) continue;
    const range = rangeOf(r.id);
    const isWhole = range !== null && Number.isFinite(range.s0) && range.s1 !== null;
    if (!isWhole) continue;
    runs.set(r.id, { id: r.id, cls: r.cls, start: r.start, end: r.end, s0: range.s0, s1: range.s1! });
  }

  /** Where the road goes on past run `id`'s end (endAhead's answer as a place). */
  const nextOf = (id: string): Next => {
    const a = endAhead(tileRuns, rangeOf, id, "end");
    if (!a.ahead) return { stop: a.why };
    const via = a.via === undefined ? undefined : runs.get(a.via);
    const isGround = a.why === "ground";
    if (isGround) return { stop: "ground" };
    if (via === undefined) return { stop: a.why };
    const isMerge = a.why === "on-parent";
    const atS = isMerge ? (runs.get(id)!.end.parentS ?? via.s0) : via.s0;
    return { run: via.id, s: atS };
  };
  const nexts = new Map([...runs.keys()].map((id) => [id, nextOf(id)]));
  /** A run whose end meets the ground (a foot: the road goes on as a street). */
  const isGroundEnd = (id: string) => {
    const n = nexts.get(id)!;
    return "stop" in n && n.stop === "ground";
  };
  /** The run a run's end goes on into from its start (s0), or null. */
  const onwardOf = (id: string) => {
    const n = nexts.get(id)!;
    const isRun = "run" in n;
    if (!isRun) return null;
    const isFromStart = Math.abs(n.s - runs.get(n.run)!.s0) < 1;
    return isFromStart ? n.run : null;
  };

  const routes: DeckRoute[] = [];
  const covered = new Map<string, Set<number>>();
  const cover = (run: string, lane: number) => {
    const set = covered.get(run) ?? new Set<number>();
    set.add(lane);
    covered.set(run, set);
  };
  const chunksOf = (id: string) => net.byRun.get(id) ?? [];
  const lanesOf = (id: string) => Math.max(1, ...chunksOf(id).map((c) => c.lanes));
  /** A cruise's limit from its game time at the posted limits: half again and a minute (routeGameSeconds reads it back). */
  const secondsFor = (gameS: number) => Math.round(gameS * 1.5 + 60);
  const wholeTime = (id: string) => timeOn(chunksOf(id), runs.get(id)!.s0, runs.get(id)!.s1);

  // ---------- main lines ----------
  // The lines are the decks' own carriageways: the 都市高速's, and a structure's street floor (P7's
  // 臨港道路 under the Rainbow Bridge, cls "street", driven as the hand table's rainbow-lower-*).
  const isLineClass = (cls: Run["cls"]) => cls === "expressway" || cls === "street";
  const mains = [...runs.values()].filter((r) => isLineClass(r.cls));
  const mainOnward = (id: string) => {
    const n = onwardOf(id);
    return n !== null && isLineClass(runs.get(n)!.cls) ? n : null;
  };
  const hasMainBefore = new Set(mains.map((r) => mainOnward(r.id)).filter((x): x is string => x !== null));
  const lines: string[][] = [];
  const inLine = new Set<string>();
  const walkFrom = (first: string) => {
    const line: string[] = [];
    for (let id: string | null = first; id !== null && !inLine.has(id); id = mainOnward(id)) {
      line.push(id);
      inLine.add(id);
    }
    lines.push(line);
  };
  for (const r of mains) if (!hasMainBefore.has(r.id)) walkFrom(r.id);
  // What is left is in a loop (C1's rings): from its smallest id.
  for (const r of mains) if (!inLine.has(r.id)) walkFrom(r.id);

  const ramps = [...runs.values()].filter((r) => r.cls === "ramp");
  // ---------- ramp paths (ramp runs joined end to start) ----------
  const rampOnward = (id: string) => {
    const n = onwardOf(id);
    return n !== null && runs.get(n)!.cls === "ramp" ? n : null;
  };
  const hasRampBefore = new Set(ramps.map((r) => rampOnward(r.id)).filter((x): x is string => x !== null));
  const inPath = new Set<string>();
  const paths: string[][] = [];
  const pathFrom = (first: string) => {
    const path: string[] = [];
    for (let id: string | null = first; id !== null && !inPath.has(id); id = rampOnward(id)) {
      path.push(id);
      inPath.add(id);
    }
    paths.push(path);
  };
  for (const r of ramps) if (!hasRampBefore.has(r.id)) pathFrom(r.id);
  for (const r of ramps) if (!inPath.has(r.id)) pathFrom(r.id);

  // Entrance paths (from the street) by the main run and run distance they merge at; exit paths (to
  // the street) by where they leave a main run.
  const entranceAt = new Map<string, Array<{ path: string[]; s: number }>>();
  const exitAt = new Map<string, Array<{ path: string[]; s: number }>>();
  for (const path of paths) {
    const first = runs.get(path[0])!;
    const last = path.at(-1)!;
    const n = nexts.get(last)!;
    const isEntrance = first.start.kind === "ground" && "run" in n && isLineClass(runs.get(n.run)!.cls);
    if (isEntrance) entranceAt.set(n.run, [...(entranceAt.get(n.run) ?? []), { path, s: n.s }]);
    const isExit = first.start.kind === "junction" && first.start.parent !== undefined && isGroundEnd(last);
    const isOffMain = isExit && isLineClass(runs.get(first.start.parent!)?.cls ?? "ramp");
    if (isOffMain)
      exitAt.set(first.start.parent!, [
        ...(exitAt.get(first.start.parent!) ?? []),
        { path, s: first.start.parentS ?? 0 },
      ]);
  }
  /** Ramp paths a main piece drives in lane 0 (C): no lane-0 route of their own. */
  const chainedPaths = new Set<string>();

  for (const line of lines) {
    // The line as run stretches end to end, each with its offset along the line (m).
    const stretches: Array<{ run: string; s0: number; s1: number; at: number }> = [];
    let total = 0;
    for (const id of line) {
      const r = runs.get(id)!;
      stretches.push({ run: id, s0: r.s0, s1: r.s1, at: total });
      total += r.s1 - r.s0;
    }
    const along = (run: string, s: number) => {
      const x = stretches.find((y) => y.run === run)!;
      return x.at + (s - x.s0);
    };
    /** Game seconds along the line from `a` to `b` metres. */
    const lineTime = (a: number, b: number) => {
      let t = 0;
      for (const x of stretches) {
        const len = x.s1 - x.s0;
        const lo = Math.max(a, x.at);
        const hi = Math.min(b, x.at + len);
        const isOver = hi > lo;
        if (isOver) t += timeOn(chunksOf(x.run), x.s0 + (lo - x.at), x.s0 + (hi - x.at));
      }
      return t;
    };
    /** The run and run distance `m` metres along the line. */
    const placeAt = (m: number): RunPlace => {
      const x = [...stretches].reverse().find((y) => y.at <= Math.max(0, m)) ?? stretches[0];
      return { run: x.run, s: Math.min(x.s1 - INSIDE_M, Math.max(x.s0 + INSIDE_M, x.s0 + (m - x.at))) };
    };
    const entrances = line.flatMap((id) =>
      (entranceAt.get(id) ?? []).map((e) => ({ ...e, m: along(id, e.s) })),
    );
    const exits = line.flatMap((id) => (exitAt.get(id) ?? []).map((e) => ({ ...e, m: along(id, e.s) })));
    // C: cut the line at its exits (each piece leaves by one), and start the next piece up an entrance
    // merging within CHAIN_NEAR_M before the cut, else OVERLAP_M before it. A piece is never longer
    // than PIECE_M: past that it is cut on the main line.
    let start: { m: number; via: (typeof entrances)[number] | null } = { m: 0, via: null };
    let piece = 0;
    while (start.m < total - INSIDE_M) {
      const limit = start.m + PIECE_M;
      const exit = exits
        .filter((e) => e.m > start.m + APPROACH_M && e.m <= limit && !chainedPaths.has(e.path[0]))
        .sort((a, b) => a.m - b.m)[0];
      const endM = exit ? exit.m : Math.min(total, limit);
      piece++;
      const from = start.via
        ? { run: start.via.path[0], s: runs.get(start.via.path[0])!.s0 + INSIDE_M }
        : placeAt(start.m);
      const mainFrom = placeAt(start.m);
      const mainTo = placeAt(endM);
      const iFrom = line.indexOf(mainFrom.run);
      const iTo = line.indexOf(mainTo.run);
      // The branch first: the cruise takes, at a fork, the first of `prefer` that leaves it
      // (expresswayDrive.ts aimAt), so the line's own run listed before its exit would keep the car
      // on the line past the exit (the trial's ramp-202805893, 2026-11-28; the hand table's
      // daiba-exit lists its exit first too).
      const prefer = [
        ...(exit ? exit.path : []),
        ...(start.via ? start.via.path : []),
        ...line.slice(iFrom, iTo + 1),
      ];
      const gameS =
        lineTime(start.m, endM) +
        (start.via ? start.via.path.reduce((a, id) => a + wholeTime(id), 0) : 0) +
        (exit ? exit.path.reduce((a, id) => a + wholeTime(id), 0) : 0);
      const lastExitRun = exit ? exit.path.at(-1)! : null;
      const route: CruiseRoute = {
        id: `main-${line[0]}-${piece}`,
        kind: "cruise",
        from,
        lane: 0,
        prefer,
        to: lastExitRun !== null ? { run: lastExitRun, street: true } : mainTo,
        kmh: CRUISE_KMH,
        seconds: secondsFor(gameS),
        was: `生成（R1-5 PR B）: 本線 ${line[0]}… の ${piece} 本目（${Math.round(start.m)}〜${Math.round(endM)} m）、車線 0${start.via ? `、入口 ${start.via.path.join("→")} から` : ""}${exit ? `、出口 ${exit.path.join("→")} へ` : ""}`,
      };
      routes.push(route);
      for (const id of route.prefer) cover(id, 0);
      if (start.via) chainedPaths.add(start.via.path[0]);
      if (exit) chainedPaths.add(exit.path[0]);
      const isDone = endM >= total - INSIDE_M;
      if (isDone) break;
      const next = entrances
        .filter(
          (e) => e.m <= endM && e.m >= endM - CHAIN_NEAR_M && e.m > start.m && !chainedPaths.has(e.path[0]),
        )
        .sort((a, b) => b.m - a.m)[0];
      start = next ? { m: next.m, via: next } : { m: Math.max(0, endM - OVERLAP_M), via: null };
    }
  }

  // Lanes 1+ of the main lines are not driven (the user's decision, 2026-11-24): the probes that see
  // every lane as a surface (the seams' steps, bare drops, the end walls) and the views do. Why not
  // the "絞" (i)/(ii) short drives round each diverge, merge and change of lane count: 272 of them on
  // central, 4.2 h of the round's 13.6 h (knowledge「P2.7 R1-5 PR B」).

  for (const path of paths) {
    const first = runs.get(path[0])!;
    const last = runs.get(path.at(-1)!)!;
    const parent =
      first.start.kind === "junction" && first.start.parent !== undefined
        ? runs.get(first.start.parent)
        : undefined;
    const from: RunPlace =
      parent !== undefined
        ? {
            run: parent.id,
            s: Math.max(parent.s0 + INSIDE_M, (first.start.parentS ?? parent.s0) - APPROACH_M),
          }
        : { run: first.id, s: first.s0 + INSIDE_M };
    const n = nexts.get(last.id)!;
    const onward = "run" in n ? runs.get(n.run)! : undefined;
    const onwardS = "run" in n ? n.s : 0;
    const to: CruiseRoute["to"] = onward
      ? { run: onward.id, s: Math.min(onward.s1 - INSIDE_M, onwardS + APPROACH_M) }
      : isGroundEnd(last.id)
        ? { run: last.id, street: true }
        : { run: last.id, s: last.s1 - INSIDE_M };
    // The ramp first and the run it leaves last (as the main pieces': the first of `prefer` that
    // leaves a fork is taken).
    const prefer = [...path, ...(onward ? [onward.id] : []), ...(parent ? [parent.id] : [])];
    const gameS =
      path.reduce((a, id) => a + wholeTime(id), 0) +
      (parent ? timeOn(chunksOf(parent.id), from.s, first.start.parentS ?? from.s) : 0) +
      (onward && "s" in to ? timeOn(chunksOf(onward.id), onwardS, to.s) : 0);
    const lanes = Math.max(...path.map(lanesOf));
    const isChained = chainedPaths.has(path[0]);
    for (let lane = isChained ? 1 : 0; lane < lanes; lane++) {
      routes.push({
        id: `ramp-${path[0]}-lane${lane}`,
        kind: "cruise",
        from,
        lane,
        prefer,
        to,
        kmh: CRUISE_KMH,
        seconds: secondsFor(gameS),
        was: `生成（R1-5 PR B）: ランプ ${path.join("→")}${parent ? `（${parent.id} の分流の ${APPROACH_M} m 手前から）` : ""}${onward ? `（${onward.id} の ${APPROACH_M} m 先まで）` : ""}、車線 ${lane}`,
      });
      for (const id of path) cover(id, lane);
    }
  }

  // ---------- walls ----------
  for (const r of runs.values()) {
    const n = nexts.get(r.id)!;
    const isDead = "stop" in n && (n.stop === "dead" || n.stop === "parent-dead");
    if (!isDead) continue;
    const from: RunPlace = { run: r.id, s: Math.max(r.s0 + INSIDE_M, r.s1 - WALL_LEAD_M) };
    for (let lane = 0; lane < lanesOf(r.id); lane++) {
      const wall: WallRoute = {
        id: `wall-${r.id}-lane${lane}-posted`,
        kind: "wall",
        from,
        lane,
        prefer: [r.id],
        wall: r.id,
        speed: "posted",
        seconds: 120,
        was: `生成（R1-5 PR B）: 先の無い端 ${r.id}:end、車線 ${lane}、規制速度`,
      };
      routes.push(wall);
      cover(r.id, lane);
    }
  }

  // ---------- autopilot: entrance → exit pairs ----------
  const entrances = net.entrances.filter((e) => runs.has(e.run)).sort((a, b) => (a.run < b.run ? -1 : 1));
  const exits = ramps.filter((r) => isGroundEnd(r.id)).sort(byId);
  const footOf = (id: string) => {
    const c = [...chunksOf(id)].sort((a, b) => a.k - b.k).at(-1)!;
    const i = c.st.length - STATION_STRIDE;
    return { lat: c.st[i + ST.lat], lon: c.st[i + ST.lon] };
  };
  const autos: AutoRoute[] = [];
  const pairs: Array<[number, number]> = [];
  const hasPairs = entrances.length > 0 && exits.length > 0;
  /** The exit (index) whose foot lies nearest AUTO_TRIP_M from entrance i, not yet paired with it (ties by id). */
  const exitFor = (i: number) => {
    const e = entrances[i];
    const kx = 111320 * Math.cos((e.lat * Math.PI) / 180);
    const scored = exits.map((x, j) => {
      const f = footOf(x.id);
      const m = Math.hypot((f.lon - e.lon) * kx, (f.lat - e.lat) * 110574);
      return { j, off: Math.abs(m - AUTO_TRIP_M) };
    });
    const free = scored.filter((x) => !pairs.some(([a, b]) => a === i && b === x.j));
    return free.toSorted((a, b) => a.off - b.off || a.j - b.j)[0]?.j ?? null;
  };
  if (hasPairs) {
    // Every route ref first (its first entrance by id), then entrances evenly through the id order.
    const refs = [...new Set(entrances.map((e) => e.route ?? ""))].filter((x) => x !== "").toSorted();
    const order = [
      ...refs.map((ref) => entrances.findIndex((e) => e.route === ref)),
      ...Array.from({ length: AUTO_ROUTES }, (_, k) => Math.floor((k * entrances.length) / AUTO_ROUTES)),
    ];
    for (const i of order) {
      const isFull = pairs.length >= AUTO_ROUTES;
      if (isFull) break;
      const j = exitFor(i);
      const isPaired = j === null || pairs.some(([a]) => a === i);
      if (!isPaired) pairs.push([i, j!]);
    }
  }
  for (const [i, j] of pairs.slice(0, AUTO_ROUTES)) {
    const e = entrances[i];
    const x = exits[j];
    autos.push({
      id: `auto-${e.run}-${x.id}`,
      kind: "auto",
      start: `${e.lat.toFixed(5)},${e.lon.toFixed(5)}`,
      entrance: e.run,
      to: footOf(x.id),
      seconds: AUTO_LIMIT,
      was: `生成（R1-5 PR B）: 自動運転、入口 ${e.run}（${e.name ?? "?"}、${e.route ?? "?"}）→ 出口 ${x.id} の足`,
    });
  }
  routes.push(...autos);

  // ---------- street places: the ramps' feet ----------
  const streetPlaces: StreetPlace[] = [];
  for (const r of ramps) {
    const isEntrance = r.start.kind === "ground";
    const isExit = isGroundEnd(r.id);
    if (isEntrance) {
      const c = [...chunksOf(r.id)].sort((a, b) => a.k - b.k)[0];
      streetPlaces.push({
        id: `foot-${r.id}-start`,
        what: `入口 ${r.id} の足`,
        at: { lat: c.st[ST.lat], lon: c.st[ST.lon] },
      });
    }
    if (isExit) streetPlaces.push({ id: `foot-${r.id}-end`, what: `出口 ${r.id} の足`, at: footOf(r.id) });
  }

  // ---------- what no route reaches ----------
  const uncovered: DistrictTable["uncovered"] = [];
  for (const r of [...net.runs].sort(byId)) {
    const isHere = districts.get(r.id) === district;
    if (!isHere) continue;
    const isClosed = net.closed.some((c) => c.run === r.id);
    if (isClosed) {
      uncovered.push({ run: r.id, why: "closed" });
      continue;
    }
    const isUnwritten = !net.byRun.has(r.id);
    if (isUnwritten) {
      uncovered.push({ run: r.id, why: "not written" });
      continue;
    }
    const isNotWhole = !runs.has(r.id);
    if (isNotWhole) {
      uncovered.push({ run: r.id, why: "not all of its chunks are in the folder" });
      continue;
    }
    if (!covered.has(r.id)) uncovered.push({ run: r.id, why: "no route" });
  }
  return { district, routes, streetPlaces, uncovered };
}

/** A route's game time at its posted limits (s), for bundling: its length over the limit, no slack. */
/**
 * An autopilot route's game time (s): R1-1b's and 手順 0's drives of auto-shiodome-shibakoen took
 * 192–233 s of game time over 2.2–2.5 km; the generated ones are of the same kind.
 */
export const AUTO_GAME_S = 210;
// (the generated routes pick their exits about AUTO_TRIP_M away for that.)
/** A wall route's game time (s): WALL_LEAD_M at a posted 60 km/h, the 5 s at the wall and the stop. */
export const WALL_GAME_S = 40;

/** A generated route's game time at its posted limits (s), for bundling: a cruise's limit read back. */
export function routeGameSeconds(r: DeckRoute): number {
  const isAuto = r.kind === "auto";
  if (isAuto) return AUTO_GAME_S;
  const isWall = r.kind === "wall";
  if (isWall) return WALL_GAME_S;
  return (r.seconds - 60) / 1.5;
}
