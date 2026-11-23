// The scorecard's parts of a --range ship build (R1-1a, report.ts version 8): the publishing stages of
// the districts, the runs --run-borders cut cut at a border, and where the written network stops (for
// R1-1b's walls). From the plan and what the build writes; the tiles of a stage are packed and gzipped
// as the build does it.
import { gzipSync } from "node:zlib";
import { endPlan, nodeS, type Plan, type RunPlan } from "../src/expressway/compile.ts";
import { type District, DISTRICTS, type DroppedRamp } from "../src/expressway/districts.ts";
import { packTiles } from "../src/expressway/files.ts";
import {
  STATION_STRIDE,
  type XwChunk,
  type XwClosed,
  type XwEntrance,
  type XwRunSummary,
} from "../src/expressway/format.ts";
import { haversine } from "../src/expressway/geo.ts";
import { isOperatorBorder } from "../src/expressway/network.ts";
import type { Report } from "../src/expressway/report.ts";
import { type InWards, nearWards } from "../src/expressway/scope.ts";

export type Written = {
  chunks: XwChunk[];
  runs: XwRunSummary[];
  closed: XwClosed[];
  entrances: XwEntrance[];
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Each publishing stage (central, + east, + yamate, + outside) of what is written. */
export function stagesOf(
  written: Written,
  districts: ReadonlyMap<string, District>,
  inWards: InWards,
  zoom: number,
): NonNullable<Report["stages"]> {
  const rank = (run: string) => DISTRICTS.indexOf(districts.get(run) ?? "outside");
  return DISTRICTS.map((_, k) => {
    const isIn = (run: string) => rank(run) <= k;
    const chunks = written.chunks.filter((c) => isIn(c.run));
    const runs = written.runs.filter((r) => isIn(r.id));
    const tiles = packTiles(
      chunks,
      runs,
      written.entrances.filter((e) => isIn(e.run)),
      zoom,
    );
    const sizes = [...tiles].map(([key, t]) => ({ key, gzip: gzipSync(JSON.stringify(t)).length }));
    const largest = sizes.reduce<{ key: string; gzip: number } | null>(
      (b, t) => (b === null || t.gzip > b.gzip ? t : b),
      null,
    );
    let inKm = 0;
    let outKm = 0;
    for (const c of chunks)
      for (let i = 0; i + STATION_STRIDE < c.st.length; i += STATION_STRIDE) {
        const step =
          haversine(c.st[i + 1], c.st[i + 2], c.st[i + STATION_STRIDE + 1], c.st[i + STATION_STRIDE + 2]) /
          1000;
        const isOver = nearWards(inWards, c.st[i + 1], c.st[i + 2]);
        if (isOver) inKm += step;
        else outKm += step;
      }
    return {
      districts: DISTRICTS.slice(0, k + 1),
      runs: runs.length,
      km: r3(runs.reduce((n, r) => n + r.lengthM, 0) / 1000),
      closed: written.closed.filter((c) => isIn(c.run)).length,
      inKm: r3(inKm),
      outKm: r3(outKm),
      tiles: tiles.size,
      gzipBytes: sizes.reduce((n, t) => n + t.gzip, 0),
      maxTileGzipBytes: largest?.gzip ?? 0,
      maxTile: largest?.key ?? null,
    };
  });
}

/** The written runs cut at a border, and the km of the other operators' runs beside them. */
export function bordersOf(plan: Plan, written: ReadonlySet<string>): NonNullable<Report["borders"]> {
  const list: NonNullable<Report["borders"]>["list"] = [];
  let otherM = 0;
  for (const [id, rp] of [...plan.runs].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const borders = rp.run.borders;
    if (!borders) continue;
    const isOtherSide = borders.includes("operator-seam") && !written.has(id);
    if (isOtherSide) otherM += rp.length;
    if (!written.has(id)) continue;
    borders.forEach((kind, side) => {
      if (kind === "none") return;
      const end = side === 0 ? "start" : "end";
      const node = plan.net.nodes.get(rp.chain.nodes[side === 0 ? rp.run.from : rp.run.to])!;
      list.push({ id: `${id}:${end}`, run: id, end, kind, ref: rp.ref, lon: node.lon, lat: node.lat });
    });
  }
  return { list, otherKm: r3(otherM / 1000) };
}

/** How far into the child its side of the parent is measured (laneLinks.ts MEASURE_M, on the plan's line). */
const SIDE_MEASURE_M = 40;

/**
 * Which side of the parent `child` lies on, seen along the parent's direction at the node: the point
 * SIDE_MEASURE_M into the child (or its length) against the parent's heading there, as laneLinks.ts
 * sideOf measures it on the road graph, here on the plan's smoothed lines (lon/lat, a local plane).
 */
function sideOf(
  parent: RunPlan,
  parentNodeIndex: number,
  child: RunPlan,
  atStart: boolean,
): "left" | "right" {
  const at = (rp: RunPlan, i: number) => rp.plane.toLonLat(rp.align.xy[2 * i], rp.align.xy[2 * i + 1]);
  const pi = Math.min(parent.i1, Math.max(parent.i0, parent.align.vertexSample[parentNodeIndex]));
  const isLast = pi >= parent.i1;
  const [ax, ay] = at(parent, isLast ? pi - 1 : pi);
  const [bx, by] = at(parent, isLast ? pi : pi + 1);
  const d = Math.min(SIDE_MEASURE_M, child.length);
  const ci = atStart ? child.i0 + Math.round(d) : child.i1 - Math.round(d);
  const [cx, cy] = at(child, Math.min(child.i1, Math.max(child.i0, ci)));
  const k = Math.cos((ay * Math.PI) / 180);
  const [ox, oy] = at(parent, pi);
  const cross = (bx - ax) * k * (cy - oy) - (by - ay) * ((cx - ox) * k);
  return cross >= 0 ? "left" : "right";
}

type EndRow = NonNullable<Report["ends"]>["mainEnds"][number];
type RampEndRow = NonNullable<NonNullable<Report["ends"]>["rampEnds"]>[number];

/**
 * Where the written network stops (R1-1a; R1-1b's N1). `mainEnds` and `rampEnds`: a written run's end
 * with nothing written going on (no written run seamed on there, no written parent it hangs from, no
 * written run of the same chain holding the node), each with its `kind` (open, ground, portal,
 * junction, seam: endPlan's), `onward` (a written run hung by a junction at the node going on beyond
 * it, R1-1b 3.1 (c)), why, the node, and `beyond` (the unwritten runs hung at that node, which are
 * then no mouths). A ramp's ground end is not listed (the road goes on in the street). A wall stands at
 * a row whose kind is not ground and whose onward is null. `mouths`: a written run where a run not
 * written hangs, at the parent's run distance, on which side of it (`side`) and where on it (`at`:
 * inside, or at its start or end), and why. `inScope`: the shipped scope's runs (the plan's wanted
 * before --districts picked), `dropped`: rule A's, `closed`: the whole build's closed.
 */
export function endsOf(
  plan: Plan,
  written: ReadonlySet<string>,
  inScope: ReadonlySet<string>,
  dropped: ReadonlyMap<string, DroppedRamp>,
  closed: ReadonlySet<string>,
): NonNullable<Report["ends"]> {
  const ids = [...plan.runs.keys()].sort();
  // The runs hanging from each run's node, as (child, end plan) pairs.
  const children = new Map<
    string,
    Array<{ child: string; parentNodeIndex: number; atStart: boolean; isSeam: boolean }>
  >();
  for (const id of ids) {
    const rp = plan.runs.get(id)!;
    for (const atStart of [true, false]) {
      const e = endPlan(plan, rp, atStart);
      const isJoined = e.kind === "junction" || e.kind === "seam";
      if (!isJoined) continue;
      children.set(e.parent, [
        ...(children.get(e.parent) ?? []),
        { child: id, parentNodeIndex: e.parentNodeIndex, atStart, isSeam: e.kind === "seam" },
      ]);
    }
  }
  /** Why a run that would go on is not written. */
  const whyNot = (id: string): "closed" | "district" | "outside" =>
    closed.has(id) ? "closed" : inScope.has(id) ? "district" : "outside";
  const mainEnds: EndRow[] = [];
  const rampEnds: RampEndRow[] = [];
  /**
   * The ends hung on a written parent at the parent's end node, that the parent does not carry on
   * (R1-1b 3.1 (d)): an end as the parent's end is, decided once the parents' ends are known.
   */
  const onParentEnd: Array<{ rp: RunPlan; atStart: boolean; parent: string; parentSide: "start" | "end" }> =
    [];
  const mouths: NonNullable<Report["ends"]>["mouths"] = [];
  for (const id of ids) {
    if (!written.has(id)) continue;
    const rp = plan.runs.get(id)!;
    const isMain = rp.cls === "expressway";
    /** The node indices of this run listed as an end: their unwritten children are no mouths. */
    const endNodes = new Set<number>();
    for (const atStart of [true, false]) {
      const e = endPlan(plan, rp, atStart);
      const idx = atStart ? rp.run.from : rp.run.to;
      const here = (children.get(id) ?? []).filter((c) => c.parentNodeIndex === idx);
      // A seam child goes on with the road; a ramp branching at the end node does not carry it on.
      const isGoingOn = here.some((c) => c.isSeam && written.has(c.child));
      // Nothing written goes on there: no written run is seamed on at that node, the end hangs from no
      // written run, and no written run of the same chain holds the node (a run at grade, a seam).
      // Why not the open ends alone: the chain going on at grade unwritten (取り込みの地平の端) ends there too.
      const isOnParent = (e.kind === "junction" || e.kind === "seam") && written.has(e.parent);
      const besides = (plan.chainRuns.get(rp.chain.id) ?? []).filter(
        (o) => o !== rp && o.run.from <= idx && idx <= o.run.to,
      );
      const isBeside = besides.some((o) => written.has(o.run.id));
      const isOpenHere = !isGoingOn && !isBeside;
      if (isOnParent && isOpenHere) {
        const pp = plan.runs.get((e as { parent: string }).parent)!;
        const pIdx = (e as { parentNodeIndex: number }).parentNodeIndex;
        const parentSide = pIdx === pp.run.from ? "start" : pIdx === pp.run.to ? "end" : null;
        // Through: this run's end on the parent's start, or its start on the parent's end.
        const isThrough = (!atStart && parentSide === "start") || (atStart && parentSide === "end");
        if (parentSide !== null && !isThrough)
          onParentEnd.push({ rp, atStart, parent: pp.run.id, parentSide });
      }
      const isEnd = !isGoingOn && !isOnParent && !isBeside;
      if (!isEnd) continue;
      const kind =
        e.kind === "ground" ? (e.into ? "portal" : "ground") : e.kind === "anchor" ? "open" : e.kind;
      const isRampGround = !isMain && kind === "ground";
      if (isRampGround) continue;
      endNodes.add(idx);
      // 3.1 (c): a written run hung at the node by a junction that goes on beyond the end (this run's
      // end meets its start, or this run's start its end).
      const onward =
        here.find((c) => !c.isSeam && written.has(c.child) && c.atStart === !atStart)?.child ?? null;
      const beyond = here
        .filter((c) => !written.has(c.child))
        .map((c) => c.child)
        .toSorted();
      const node = plan.net.nodes.get(rp.chain.nodes[idx])!;
      const end = atStart ? "start" : "end";
      const row = { id: `${id}:${end}`, run: id, end, kind, onward, lon: node.lon, lat: node.lat } as const;
      const extra = beyond.length > 0 ? { beyond } : {};
      if (isMain) {
        const border = rp.run.borders?.[atStart ? 0 : 1];
        // A run of the scope goes on there (the parent it merges into, the chain's run beside) but is
        // not written: a later stage's (--districts). Else the scope ends there.
        const isOnScope = (e.kind === "junction" || e.kind === "seam") && inScope.has(e.parent);
        const isBesideScope = besides.some((o) => inScope.has(o.run.id));
        const isLater = isOnScope || isBesideScope;
        const why = isOperatorBorder(border)
          ? "operator"
          : border === "open"
            ? "ref"
            : isLater
              ? "district"
              : "scope";
        mainEnds.push({ ...row, why, ...extra });
        continue;
      }
      // A ramp's end: why the run it would go on into is not written (its parent, a run beside it, or
      // an unwritten child seamed on), else the scope's end.
      const isJoined = e.kind === "junction" || e.kind === "seam";
      const next = isJoined ? e.parent : (besides[0]?.run.id ?? here.find((c) => c.isSeam)?.child ?? null);
      const why = next === null ? "scope" : whyNot(next);
      rampEnds.push({ ...row, why, ...extra });
    }
    for (const c of children.get(id) ?? []) {
      if (written.has(c.child)) continue;
      // An unwritten child at a node listed as an end is that end's `beyond`, not a mouth too (R1-1a
      // review 2 N1: 46876435:end, 46913090:start, 5204787:start and 5204789:end counted twice).
      const isAtEnd = endNodes.has(c.parentNodeIndex);
      if (isAtEnd) continue;
      const crp = plan.runs.get(c.child)!;
      // The far sides of the borders are the main lines' ends above, not mouths.
      const childBorder = crp.run.borders?.[c.atStart ? 0 : 1];
      const isBorderChild = childBorder === "operator-seam" || childBorder === "seam";
      if (isBorderChild) continue;
      const why = closed.has(c.child)
        ? "closed"
        : dropped.has(c.child)
          ? "ruleA"
          : inScope.has(c.child)
            ? "district"
            : "outside";
      const at =
        c.parentNodeIndex === rp.run.from ? "start" : c.parentNodeIndex === rp.run.to ? "end" : "inside";
      const side = sideOf(rp, c.parentNodeIndex, crp, c.atStart);
      mouths.push({
        run: id,
        s: Math.round(nodeS(rp, c.parentNodeIndex) * 10) / 10,
        child: c.child,
        why,
        side,
        at,
      });
    }
  }
  // (d): until nothing more is found, an end hung at a parent's end that is a wall is a wall too (as
  // the runtime's endAhead decides it: src/world/expresswayEnds.ts). Why not left out (as R1-1a's list
  // did, the parent being written): the child's deck reaches past the parent's end there (224864773:end
  // on 224864769:end, 709826346:end on 44803854:end), and nothing goes on beyond either.
  const isWall = (e: { kind?: string; onward?: string | null }) =>
    e.kind !== "ground" && (e.onward ?? null) === null;
  for (let isGrown = true; isGrown;) {
    isGrown = false;
    const walls = new Map<string, EndRow | RampEndRow>();
    for (const e of [...mainEnds, ...rampEnds]) if (isWall(e)) walls.set(e.id, e);
    for (const item of onParentEnd) {
      const end = item.atStart ? "start" : "end";
      const id = `${item.rp.run.id}:${end}`;
      const isListed = mainEnds.some((e) => e.id === id) || rampEnds.some((e) => e.id === id);
      const parentWall = walls.get(`${item.parent}:${item.parentSide}`);
      if (isListed || !parentWall) continue;
      const e = endPlan(plan, item.rp, item.atStart);
      const idx = item.atStart ? item.rp.run.from : item.rp.run.to;
      const here = (children.get(item.rp.run.id) ?? []).filter((c) => c.parentNodeIndex === idx);
      const onward =
        here.find((c) => !c.isSeam && written.has(c.child) && c.atStart === !item.atStart)?.child ?? null;
      const beyond = here
        .filter((c) => !written.has(c.child))
        .map((c) => c.child)
        .toSorted();
      const node = plan.net.nodes.get(item.rp.chain.nodes[idx])!;
      const kind = e.kind === "seam" ? "seam" : "junction";
      const row = {
        id,
        run: item.rp.run.id,
        end,
        kind,
        onward,
        lon: node.lon,
        lat: node.lat,
        ...(beyond.length > 0 ? { beyond } : {}),
      } as const;
      const isMain = item.rp.cls === "expressway";
      const parentWhy = parentWall.why;
      if (isMain) {
        const why =
          parentWhy === "operator" || parentWhy === "ref" || parentWhy === "district" ? parentWhy : "scope";
        mainEnds.push({ ...row, why });
      } else {
        const why =
          parentWhy === "closed" || parentWhy === "district" || parentWhy === "outside" ? parentWhy : "scope";
        rampEnds.push({ ...row, why });
      }
      isGrown = true;
    }
  }
  mainEnds.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  rampEnds.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { mainEnds, rampEnds, mouths };
}
