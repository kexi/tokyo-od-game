import { PARAPET_WIDTH } from "../../src/expressway/assumptions.ts";
import { ST, STATION_STRIDE, type XwChunk } from "../../src/expressway/format.ts";
import type { HoleLanes } from "../expresswayCases.ts";
import { HOLE_SITE_MARGIN_M, type SiteLanes } from "../expresswaySiteLanes.ts";
import type { KnownCase, RunProjection } from "./streetDriveVerdict.ts";

/**
 * The street drive's known cases (streetDriveVerdict.ts) from the probes' lists and the data folder
 * (R1-5 PR A 3.3), and a point's place along a run, for telling whether a drive failed inside one.
 * The reach of each case is the probe's own: lane-in-site counts a lane within the slab's half width
 * and the parapet (expresswayLanesProbe.ts edgeM, of the case's chunk); street-lane-over-cut within
 * the hole's half width (holeHalfM, the widest cut chunk's carriageway and the wall) and the probe's
 * margin, over the run's cut chunks.
 */

type ByRun = ReadonlyMap<string, readonly XwChunk[]>;

const halfWidth = (c: XwChunk) => (c.lanes * c.laneWidth + c.shoulderL + c.shoulderR) / 2;

/** The run distances a set of chunks spans: its first and last stations' s. */
function spanOf(chunks: readonly XwChunk[]): [number, number] | null {
  const hasChunks = chunks.length > 0;
  if (!hasChunks) return null;
  let s0 = Infinity;
  let s1 = -Infinity;
  for (const c of chunks) {
    s0 = Math.min(s0, c.st[ST.s]);
    s1 = Math.max(s1, c.st[c.st.length - STATION_STRIDE + ST.s]);
  }
  return [s0, s1];
}

export function knownCasesFrom(
  site: readonly SiteLanes[],
  hole: readonly HoleLanes[],
  byRun: ByRun,
): KnownCase[] {
  const out: KnownCase[] = [];
  for (const p of site) {
    const chunk = (byRun.get(p.run) ?? []).find((c) => c.id === p.chunk);
    // Why throw: a list from another build names chunks this one has not, and its cases would be wrong.
    const isMissing = chunk === undefined;
    if (isMissing) throw new Error(`lane-in-site ${p.run} s ${p.s0}: no chunk ${p.chunk} in the data`);
    out.push({
      key: `lane-in-site:${p.run}@${p.s0}-${p.s1}`,
      run: p.run,
      s0: p.s0,
      s1: p.s1,
      reachM: halfWidth(chunk) + PARAPET_WIDTH.value,
    });
  }
  for (const h of hole) {
    const cuts = (byRun.get(h.run) ?? []).filter((c) => c.structure === "cut");
    const span = spanOf(cuts);
    const hasNoCut = span === null;
    if (hasNoCut) throw new Error(`street-lane-over-cut ${h.run}: no cut chunk in the data`);
    out.push({
      key: `street-lane-over-cut:${h.run}`,
      run: h.run,
      s0: span[0],
      s1: span[1],
      reachM: h.holeHalfM + HOLE_SITE_MARGIN_M,
    });
  }
  return out;
}

/** Metres per degree of latitude and of longitude at the equator (a flat step over a run's length). */
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320;

/**
 * A point's run distance and distance from a run's centre line (its stations end to end in chunk
 * order), at the nearest point of the line; null when the data has no such run or the nearest point
 * is an end of the line (the point is past it, not beside it).
 */
export function projectOnRun(byRun: ByRun, run: string, lat: number, lon: number): RunProjection | null {
  const list = (byRun.get(run) ?? []).toSorted((a, b) => a.k - b.k);
  const pts: Array<{ s: number; x: number; z: number }> = [];
  const kx = M_PER_DEG_LON * Math.cos((lat * Math.PI) / 180);
  for (const c of list)
    for (let i = 0; i < c.st.length; i += STATION_STRIDE)
      pts.push({
        s: c.st[i + ST.s],
        x: (c.st[i + ST.lon] - lon) * kx,
        z: (c.st[i + ST.lat] - lat) * M_PER_DEG_LAT,
      });
  let best: { d: number; s: number; t: number; i: number } | null = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const [ex, ez] = [b.x - a.x, b.z - a.z];
    const l2 = ex * ex + ez * ez;
    const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, (-a.x * ex - a.z * ez) / l2));
    const d = Math.hypot(a.x + ex * t, a.z + ez * t);
    const isNearer = best === null || d < best.d;
    if (isNearer) best = { d, s: a.s + (b.s - a.s) * t, t, i };
  }
  // Why not a named condition: a const loses the null narrowing of `best` below.
  if (best === null) return null;
  const isPastStart = best.i === 0 && best.t === 0;
  const isPastEnd = best.i === pts.length - 2 && best.t === 1;
  if (isPastStart || isPastEnd) return null;
  return { s: best.s, offM: best.d };
}
