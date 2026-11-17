// The scorecard's parts of a --range ship build (R1-1a, report.ts version 8): the publishing stages of
// the districts, the runs --run-borders cut cut at a border, and where the written network stops (for
// R1-1b's walls). From the plan and what the build writes; the tiles of a stage are packed and gzipped
// as the build does it.
import { gzipSync } from "node:zlib";
import { endPlan, nodeS, type Plan } from "../src/expressway/compile.ts";
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

/**
 * Where the written network stops: the written main lines' ends with nothing written beyond, and the
 * mouths on written runs where a run not written hangs. `inScope`: the shipped scope's runs (the
 * plan's wanted before --districts picked), `dropped`: rule A's, `closed`: the whole build's closed.
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
  const children = new Map<string, Array<{ child: string; parentNodeIndex: number; atStart: boolean }>>();
  for (const id of ids) {
    const rp = plan.runs.get(id)!;
    for (const atStart of [true, false]) {
      const e = endPlan(plan, rp, atStart);
      const isJoined = e.kind === "junction" || e.kind === "seam";
      if (!isJoined) continue;
      children.set(e.parent, [
        ...(children.get(e.parent) ?? []),
        { child: id, parentNodeIndex: e.parentNodeIndex, atStart },
      ]);
    }
  }
  const mainEnds: NonNullable<Report["ends"]>["mainEnds"] = [];
  const mouths: NonNullable<Report["ends"]>["mouths"] = [];
  for (const id of ids) {
    if (!written.has(id)) continue;
    const rp = plan.runs.get(id)!;
    const isMain = rp.cls === "expressway";
    for (const atStart of [true, false]) {
      if (!isMain) continue;
      const e = endPlan(plan, rp, atStart);
      const idx = atStart ? rp.run.from : rp.run.to;
      const isGoingOn = (children.get(id) ?? []).some(
        (c) => c.parentNodeIndex === idx && written.has(c.child),
      );
      const isEnd = e.kind === "open" && !isGoingOn;
      if (!isEnd) continue;
      const border = rp.run.borders?.[atStart ? 0 : 1];
      const why = isOperatorBorder(border) ? "operator" : border === "open" ? "ref" : "scope";
      const node = plan.net.nodes.get(rp.chain.nodes[idx])!;
      const end = atStart ? "start" : "end";
      mainEnds.push({ id: `${id}:${end}`, run: id, end, why, lon: node.lon, lat: node.lat });
    }
    for (const c of children.get(id) ?? []) {
      if (written.has(c.child)) continue;
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
      mouths.push({ run: id, s: Math.round(nodeS(rp, c.parentNodeIndex) * 10) / 10, child: c.child, why });
    }
  }
  return { mainEnds, mouths };
}
