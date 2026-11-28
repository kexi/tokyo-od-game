// Where RoadGraph.locate answers a car on an expressway deck with another run's deck (P2.7 R1-4a-1): every
// lane centre of every chunk (main lines and ramps), every 2 m, at the car's body centre over its own road
// (+CAR_RIDE_HEIGHT, physics/carBody.ts), asked with graph.locate(p, 30)
// in a network of the expressway alone (joinExpressway([], …)) per tile of the folder (the tile's chunks
// and its 8 neighbours', in a frame at the tile's centre: scripts/expresswaySeams.ts framesOf), the points
// of the tile's own chunks. Each answer is one of: the same run; another run on the same surface (the two
// roads within MERGE_MAX_DZ there: the 分合流, deckRank's order by design); another run on another surface
// (the mix-up). A mix-up is where a car can be (the answer's road below its own, or the answer's deck's
// underside above the car's roof: road − girder over the girder's bottom flange, road − SLAB beside it,
// against own road + CAR_RIDE_HEIGHT + CAR_HALF.y) or cannot be (the other deck's body within the car's height).
// It also asks, from the same candidates, the forms the fix may take (--forms): which surface the car is
// on, then deckRank's order among the candidates within MERGE_MAX_DZ of it. The candidates are
// nearestOnSurface's own (the decks within the carriageway + DECK_REACH and SURFACE_GATE of p) and its
// rank as main had them before R1-4a-1 (deckRank over every deck: the form "now"), re-done here; the points
// where graph.locate answers otherwise than that are counted (differsFromMain), and of those the ones where
// main's answer was on the car's own surface (sameSurfaceChanged, listed: R1-4a-1's line 2 wants none).
// One JSON log line (expressway_locate_probed); --out <file> writes the pairs; exit code 1 when a mix-up
// is left where a car can be.
// --points <file> writes main's mix-ups one per point (lat, lon, ellipsoidal h of the car's body centre,
// the lane's direction in the tile's frame) for a check with the decks' colliders.
// Run: pnpm exec tsx scripts/expresswayLocateProbe.ts <dir|label> [--out <file>] [--forms] [--points <file>]
// (just check-expressway-locate <dir>).
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Vector3 } from "three";
import { ST, STATION_STRIDE, type XwChunk } from "../src/expressway/format.ts";
import { LocalFrame } from "../src/geo/frame.ts";
import { log } from "../src/log.ts";
import { CAR_HALF, CAR_RIDE_HEIGHT } from "../src/physics/carBody.ts";
import { GIRDER_BOTTOM_SHARE, SLAB } from "../src/world/expresswayDeck.ts";
import { MERGE_MAX_DZ } from "../src/world/expresswayMerge.ts";
import { expresswayRoadInput, joinExpressway } from "../src/world/expresswayRoads.ts";
import { laneCentreOffset } from "../src/world/laneChange.ts";
import { classOf, isOnGround } from "../src/world/roadClass.ts";
import {
  DECK_REACH,
  FEET_REACH,
  leftOf,
  RoadGraph,
  type Segment,
  speedLimit,
  SURFACE_GATE,
} from "../src/world/roads.ts";
import { readExpresswayFiles } from "./expresswayFiles.ts";
import { framesOf } from "./expresswaySeams.ts";

const ROOT = join(import.meta.dirname, "..");
/** graph.locate's reach as the law check asks it (main.ts). */
const MAX_DIST_M = 30;
const STEP_M = 2;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUED = new Set(["--out", "--points", "--dy"]);
const target = args.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.has(args[i - 1])));
if (target === undefined)
  throw new Error("usage: expresswayLocateProbe.ts <dir|label> [--out <file>] [--forms]");
const dir = target.includes("/") ? target : join(ROOT, ".cache", "expressway-area", target);
const withForms = args.includes("--forms");
/** The car's point moved this far from CAR_RIDE_HEIGHT over its road (m; −0.07 a car at rest, R1-4a-1 review A). */
const DY = Number(flag("dy") ?? 0);
const started = performance.now();
const files = readExpresswayFiles(dir);
const runs = [...new Map([...files.tiles.values()].flatMap((t) => t.runs).map((r) => [r.id, r])).values()];
const chunkById = new Map(files.chunks.map((c) => [c.id, c]));
const runOf = (xid: string) => xid.split(":")[0];
const r = (v: number) => Math.round(v * 100) / 100;

type Candidate = { seg: Segment; y: number; rank: number; dist: number; s: number };
/** nearestOnSurface's decks for p (roads.ts): within the carriageway + DECK_REACH and SURFACE_GATE. */
function candidates(g: RoadGraph, p: Vector3): Candidate[] {
  const out: Candidate[] = [];
  for (const seg of g.segments) {
    if (isOnGround(seg.line)) continue;
    const on = g.nearestOn(seg, p);
    if (on.dist >= MAX_DIST_M) continue;
    const isBesideDeck = on.dist > seg.line.width / 2 + DECK_REACH;
    if (isBesideDeck) continue;
    const y = g.surfaceY(seg, on.s);
    if (y === null) continue;
    const isOtherLevel = Math.abs(p.y - y) > SURFACE_GATE;
    if (isOtherLevel) continue;
    const isMain = classOf(seg.line) === "expressway";
    out.push({ seg, y, dist: on.dist, s: on.s, rank: (isMain ? 1e6 : 0) + speedLimit(seg) * 1e3 - on.dist });
  }
  return out;
}
const best = (list: Candidate[]) =>
  list.reduce<Candidate | null>((b, c) => (b === null || c.rank > b.rank ? c : b), null);
/** The candidates on the same surface as `on` (within MERGE_MAX_DZ), in deckRank's order. */
const onSurface = (list: Candidate[], on: Candidate | null) =>
  on === null ? null : best(list.filter((c) => Math.abs(c.y - on.y) <= MERGE_MAX_DZ));
const FORMS: Record<string, (list: Candidate[], p: Vector3) => Candidate | null> = {
  now: (list) => best(list),
  // (イ) The highest road not over the car's point is the one it is on.
  i: (list, p) => {
    const under = list.filter((c) => c.y <= p.y);
    const on = under.reduce<Candidate | null>((b, c) => (b === null || c.y > b.y ? c : b), null);
    return onSurface(list, on) ?? best(list);
  },
  // (ロ) The road nearest the car's point in height is the one it is on.
  ro: (list, p) => {
    const on = list.reduce<Candidate | null>(
      (b, c) => (b === null || Math.abs(p.y - c.y) < Math.abs(p.y - b.y) ? c : b),
      null,
    );
    return onSurface(list, on);
  },
  // (ハ) Drop the candidates lower than the highest road not over the car's point by more than
  // MERGE_MAX_DZ, then deckRank's order among the rest (those above it stay).
  ha: (list, p) => {
    const under = list.filter((c) => c.y <= p.y);
    const top = under.reduce((m, c) => Math.max(m, c.y), -Infinity);
    return best(list.filter((c) => c.y >= top - MERGE_MAX_DZ));
  },
  // (ニ) As (ハ), the highest road taken only from candidates whose nearest point lies inside their
  // segment (not clamped to an end: a chunk's next segment read at its end is not under the point).
  ni: (list, p) => {
    const under = list.filter((c) => c.y <= p.y && c.s > 0 && c.s < c.seg.length);
    const top = under.reduce((m, c) => Math.max(m, c.y), -Infinity);
    return best(list.filter((c) => c.y >= top - MERGE_MAX_DZ));
  },
  // (ホ) As (イ), the road the car is on taken only from candidates whose nearest point lies inside
  // their segment (as (ニ)); deckRank's order among the candidates within MERGE_MAX_DZ of it.
  ho: (list, p) => {
    const under = list.filter((c) => c.y <= p.y && c.s > 0 && c.s < c.seg.length);
    const on = under.reduce<Candidate | null>((b, c) => (b === null || c.y > b.y ? c : b), null);
    return onSurface(list, on) ?? best(list);
  },
  // (ヘ) As (ホ), the road the car is on read from its body centre's height: candidates not over
  // p.y − CAR_RIDE_HEIGHT + FEET_REACH (roads.ts deckUnderCar, the form taken).
  he: (list, p) => {
    const under = list.filter(
      (c) => c.y <= p.y - CAR_RIDE_HEIGHT + FEET_REACH && c.s > 0 && c.s < c.seg.length,
    );
    const on = under.reduce<Candidate | null>((b, c) => (b === null || c.y > b.y ? c : b), null);
    return onSurface(list, on) ?? best(list);
  },
  // (ヘ') As (ヘ), the surface widened one step: the candidates within MERGE_MAX_DZ of the stand, and
  // those within MERGE_MAX_DZ of any of them inside its segment and under the feet (a "same surface"
  // read through a neighbour, which (ヘ) does not: R1-4a-1 review B).
  he2: (list, p) => {
    const feet = p.y - CAR_RIDE_HEIGHT + FEET_REACH;
    const under = list.filter((c) => c.y <= feet && c.s > 0 && c.s < c.seg.length);
    const on = under.reduce<Candidate | null>((b, c) => (b === null || c.y > b.y ? c : b), null);
    if (on === null) return best(list);
    const first = list.filter((c) => Math.abs(c.y - on.y) <= MERGE_MAX_DZ);
    const links = first.filter((c) => c.y <= feet && c.s > 0 && c.s < c.seg.length);
    const isReached = (c: Candidate) => links.some((l) => Math.abs(c.y - l.y) <= MERGE_MAX_DZ);
    return best(list.filter(isReached));
  },
};

/** The run distance of a point on a chunk: its nearest station (local frame). */
function runS(c: XwChunk, frame: LocalFrame, p: Vector3): number {
  let bestS = c.st[ST.s];
  let bestD = Infinity;
  for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
    const q = frame.toLocal(c.st[i + ST.lat], c.st[i + ST.lon], 0);
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bestD) {
      bestD = d;
      bestS = c.st[i + ST.s];
    }
  }
  return bestS;
}

type Kind = "same-run" | "same-surface" | "other-surface";
type Point = {
  own: string;
  ans: string;
  lane: number;
  s: number;
  dz: number;
  canBe: boolean;
  ownLimit: number;
  ansLimit: number;
  ownMain: boolean;
  ansMain: boolean;
};
const counts = {
  points: 0,
  none: 0,
  differsFromMain: 0,
  sameSurfaceChanged: 0,
  "same-run": 0,
  "same-surface": 0,
  "other-surface": 0,
};
const sameSurfaceLower = { ownMain: 0, ownRamp: 0 };
const mixups: Point[] = [];
const sameLower: Point[] = [];
const formStats: Record<
  string,
  { canBeLeft: number; cannotBeLeft: number; sameChanged: number; sameChangedCannotBe: number }
> = {};
const changed: Record<string, Array<Record<string, unknown>>> = {};
const sameChangedList: Array<Record<string, unknown>> = [];
/** Per form (--forms), the mix-ups it leaves where a car can be, one per point. */
const formMixups: Record<string, Array<Record<string, unknown>>> = {};
/** main's mix-ups, one per point, for a collider check (--points <file>). */
const mainMixups: Array<Record<string, unknown>> = [];
const pointsOut = flag("points");
for (const f of Object.keys(FORMS))
  formStats[f] = { canBeLeft: 0, cannotBeLeft: 0, sameChanged: 0, sameChangedCannotBe: 0 };
const tileOf = new Map<string, string>();
for (const [key, t] of files.tiles) for (const c of t.chunks) tileOf.set(c.id, key);
const frames = framesOf(files.tiles, files.meta.zoom);
const keys = [...files.tiles.keys()].filter((k) => files.tiles.get(k)!.chunks.length > 0).toSorted();
keys.forEach((key, fi) => {
  const [tx, ty] = key.split("-").map(Number);
  const window = new Set<string>();
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) window.add(`${tx + dx}-${ty + dy}`);
  const chunks = files.chunks.filter((c) => window.has(tileOf.get(c.id) ?? ""));
  const own = new Set(files.tiles.get(key)!.chunks.map((c) => c.id));
  const frame = new LocalFrame(frames[fi].lat, frames[fi].lon, 40);
  const g = new RoadGraph(
    joinExpressway(
      [],
      expresswayRoadInput(chunks, runs, (_a, _b, h) => h + 36.9),
      () => {},
    ),
    frame,
  );
  for (const seg of g.segments) {
    const xid = seg.line.xid;
    const isOwnTile = xid !== undefined && own.has(xid);
    if (!isOwnTile) continue;
    for (let lane = 0; lane < seg.lanes; lane++) {
      for (let s = 1; s < seg.length; s += STEP_M) {
        const y0 = g.surfaceY(seg, s);
        if (y0 === null) continue;
        const { pos, dir: along } = g.sample(seg, s);
        const p = pos
          .clone()
          .add(leftOf(along, laneCentreOffset(seg, lane)))
          .setY(y0 + CAR_RIDE_HEIGHT + DY);
        counts.points++;
        const hit = g.locate(p, MAX_DIST_M);
        const list = candidates(g, p);
        const now = FORMS.now(list, p);
        if (hit === null) {
          counts.none++;
          continue;
        }
        const isChanged = now?.seg !== hit.seg;
        if (isChanged) counts.differsFromMain++;
        const isMainOnOwn = now !== null && Math.abs(now.y - y0) <= MERGE_MAX_DZ;
        if (isChanged && isMainOnOwn) {
          counts.sameSurfaceChanged++;
          sameChangedList.push({
            own: xid,
            lane,
            s: runS(chunkById.get(xid)!, frame, p),
            main: now.seg.line.xid,
            now: hit.seg.line.xid,
            dz: r((g.surfaceY(hit.seg, hit.s) ?? Number.NaN) - y0),
          });
        }
        const ans = hit.seg.line.xid ?? "";
        const yAns = g.surfaceY(hit.seg, hit.s) ?? Number.NaN;
        const dz = yAns - y0;
        const kind: Kind =
          runOf(ans) === runOf(xid)
            ? "same-run"
            : Math.abs(dz) <= MERGE_MAX_DZ
              ? "same-surface"
              : "other-surface";
        counts[kind]++;
        const ownMain = classOf(seg.line) === "expressway";
        const point = (canBe: boolean): Point => ({
          own: xid,
          ans,
          lane,
          s: runS(chunkById.get(xid)!, frame, p),
          dz,
          canBe,
          ownLimit: speedLimit(seg),
          ansLimit: speedLimit(hit.seg),
          ownMain,
          ansMain: classOf(hit.seg.line) === "expressway",
        });
        // Whether a car can be at p beside a deck at height y (another surface than its own).
        const canBeBeside = (c: { seg: Segment; y: number; dist: number }) => {
          const isBelow = c.y < y0;
          if (isBelow) return true;
          const other = chunkById.get(c.seg.line.xid ?? "");
          const half = c.seg.line.width / 2;
          const isOverFlange = c.dist <= half * GIRDER_BOTTOM_SHARE;
          const depth = isOverFlange ? Math.max(SLAB, other?.girder ?? SLAB) : SLAB;
          return c.y - depth >= y0 + CAR_RIDE_HEIGHT + CAR_HALF.y;
        };
        const isLowerOnSame =
          kind === "same-surface" && hit.seg !== seg && speedLimit(hit.seg) < speedLimit(seg);
        if (isLowerOnSame) {
          if (ownMain) sameSurfaceLower.ownMain++;
          else sameSurfaceLower.ownRamp++;
          sameLower.push(point(true));
        }
        if (kind === "other-surface")
          mixups.push(point(canBeBeside({ seg: hit.seg, y: yAns, dist: Math.abs(hit.lateral) })));
        const isMainMixup = now !== null && runOf(now.seg.line.xid ?? "") !== runOf(xid) && !isMainOnOwn;
        if (isMainMixup && pointsOut !== undefined) {
          const at = frame.toGeodetic(p);
          mainMixups.push({
            own: xid,
            ans: now.seg.line.xid,
            lat: at.lat,
            lon: at.lon,
            h: at.h,
            dirX: along.x,
            dirZ: along.z,
            dz: r(now.y - y0),
            canBe: canBeBeside(now),
          });
        }
        if (!withForms) continue;
        const isSameNow = isMainOnOwn;
        // A point a car cannot be at: some deck over its road by more than MERGE_MAX_DZ within the car's
        // height (canBeBeside false). Why not canBeBeside of the form's answer: on the car's own surface
        // that answer is never "beside", and every such point read as one a car cannot be at.
        const isCrowded = list.some((c) => c.y - y0 > MERGE_MAX_DZ && !canBeBeside(c));
        for (const [name, form] of Object.entries(FORMS)) {
          const a = form(list, p);
          if (a === null) continue;
          const isOther = runOf(a.seg.line.xid ?? "") !== runOf(xid) && Math.abs(a.y - y0) > MERGE_MAX_DZ;
          const isSameChanged = isSameNow && a.seg !== now!.seg;
          if (isSameChanged) {
            formStats[name].sameChanged++;
            if (isCrowded) formStats[name].sameChangedCannotBe++;
            (changed[name] ??= []).push({
              own: xid,
              lane,
              s: runS(chunkById.get(xid)!, frame, p),
              now: now!.seg.line.xid,
              nowDz: r(now!.y - y0),
              crowded: isCrowded,
              form: a.seg.line.xid,
              formDz: Math.round((a.y - y0) * 100) / 100,
            });
          }
          if (!isOther) continue;
          const isCanBe = canBeBeside(a);
          if (isCanBe) {
            formStats[name].canBeLeft++;
            (formMixups[name] ??= []).push({
              own: xid,
              lane,
              s: runS(chunkById.get(xid)!, frame, p),
              form: a.seg.line.xid,
              formDz: r(a.y - y0),
            });
          }
          if (!isCanBe) formStats[name].cannotBeLeft++;
        }
      }
    }
  }
});

type Pair = {
  own: string;
  ans: string;
  points: number;
  canBe: number;
  s0: number;
  s1: number;
  minDz: number;
  maxDz: number;
  lanes: number[];
  limits: string[];
};
const pairsOf = (list: Point[]): Pair[] => {
  const m = new Map<string, Pair>();
  for (const p of list) {
    const key = `${runOf(p.own)}|${runOf(p.ans)}`;
    const e = m.get(key) ?? {
      own: runOf(p.own),
      ans: runOf(p.ans),
      points: 0,
      canBe: 0,
      s0: Infinity,
      s1: -Infinity,
      minDz: Infinity,
      maxDz: -Infinity,
      lanes: [],
      limits: [],
    };
    e.points++;
    if (p.canBe) e.canBe++;
    e.s0 = Math.min(e.s0, p.s);
    e.s1 = Math.max(e.s1, p.s);
    e.minDz = Math.min(e.minDz, p.dz);
    e.maxDz = Math.max(e.maxDz, p.dz);
    if (!e.lanes.includes(p.lane)) e.lanes.push(p.lane);
    const l = `${p.ownMain ? "main" : "ramp"} ${p.ownLimit}→${p.ansMain ? "main" : "ramp"} ${p.ansLimit}`;
    if (!e.limits.includes(l)) e.limits.push(l);
    m.set(key, e);
  }
  return [...m.values()]
    .map((e) => ({ ...e, minDz: r(e.minDz), maxDz: r(e.maxDz) }))
    .toSorted((a, b) => b.points - a.points);
};
const mixPairs = pairsOf(mixups);
const canBe = mixups.filter((p) => p.canBe);
const fields = {
  dir: target,
  points: counts.points,
  none: counts.none,
  differsFromMain: counts.differsFromMain,
  sameSurfaceChanged: counts.sameSurfaceChanged,
  sameRun: counts["same-run"],
  sameSurface: counts["same-surface"],
  sameSurfaceLowerLimit: sameSurfaceLower,
  otherSurface: counts["other-surface"],
  otherSurfacePairs: mixPairs.length,
  canBe: canBe.length,
  canBePairs: pairsOf(canBe).length,
  cannotBe: mixups.length - canBe.length,
  limitDiffers: mixups.filter((p) => p.ownLimit !== p.ansLimit).length,
  forms: withForms ? formStats : null,
  durationMs: Math.round(performance.now() - started),
};
log("expressway_locate_probed", fields);
const out = flag("out");
if (out !== undefined)
  await writeFile(
    out,
    JSON.stringify(
      {
        ...fields,
        mixups: mixPairs,
        sameSurfaceLower: pairsOf(sameLower),
        sameChangedList,
        changed,
        formMixups,
      },
      null,
      1,
    ) + "\n",
  );
if (pointsOut !== undefined) await writeFile(pointsOut, JSON.stringify(mainMixups) + "\n");
if (canBe.length > 0) process.exitCode = 1;
