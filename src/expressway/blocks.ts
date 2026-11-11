import { BLOCK_ANCHOR_SPACING, BLOCK_QUIET_MIN } from "./assumptions";
import { belowStructure } from "./below";
import {
  approachLength,
  type DeckPair,
  type EndPlan,
  endPlan,
  groupComponents,
  nodeS,
  type Plan,
  type RunPlan,
} from "./compile";
import type { Zone } from "./vertical";

/**
 * Blocks (P2.7-2, `--partition blocks`, measuring only): a main line is cut at anchors in its quiet
 * stretches into pieces, and the pieces joined by junctions, seams, crossings and decks over one
 * another make the blocks the compiler solves one by one (compile.ts solvePlan, the same
 * solveShedding as for a component). An anchor is no coupling: both pieces beside it take the
 * elevation, grade and bank of the run's route solution there (compile.ts solveRoute).
 *
 * This module only decides where the anchors go and maps the plan onto pieces, from the whole plan
 * (after pruneBelow) alone: no DEM, no roads underneath, no range, so the anchors are the same
 * whichever range is built (T8). With no anchor the piece plan is the plan itself, run for run.
 * Pure.
 */

/** A block's first QP may have no more variables than this (I7); else the build stops. */
export const BLOCK_MAX_VARIABLES = 20_000;

/** An anchor: on `run` at run distance `s` (a plan sample), the k-th of the run, with its margin q. */
export type AnchorPoint = { run: string; k: number; s: number; sample: number; q: number };

/** A piece [a, b] of a run (run distances), the k-th; `id` is the run's own when it has no anchor. */
export type PieceInfo = { id: string; run: string; k: number; a: number; b: number };

export type BlockPartition = {
  quietFactor: number;
  quietMinM: number;
  anchors: AnchorPoint[];
  /** The plan of the pieces: runs are pieces, crossings and pairs on them, components the blocks. */
  pieces: Plan;
  piecesOf: Map<string, PieceInfo[]>;
  pieceInfo: Map<string, PieceInfo>;
  /** Blocks holding a piece of a wanted run, by id. */
  neededBlocks: string[];
  /** Runs with a piece in a needed block, and the runs their route solutions need (seam groups). */
  neededRuns: string[];
  /** Seam groups (sorted runs) holding an anchored run with a piece in a needed block. */
  routeGroups: string[][];
};

/** The piece id of the k-th piece of a run cut at anchors (the run's id when it is not cut). */
export function pieceId(run: string, k: number, isCut: boolean): string {
  return isCut ? `${run}#${k}` : run;
}

/** Q of a run: max(BLOCK_QUIET_MIN, k × approachLength at its plan speed). */
export function quietMargin(rp: RunPlan, factor: number, quietMin = BLOCK_QUIET_MIN.value): number {
  return Math.max(quietMin, factor * approachLength(rp.planV));
}

/**
 * Run distances of the noisy points of every run, as closed intervals: the ends, where other runs
 * join it (junctions and seams), its crossings and deck pairs, a structure's pinned range, the
 * portals inside a below run, and the design-speed zones' boundaries.
 */
export function noisyStretches(plan: Plan): Map<string, Array<[number, number]>> {
  const out = new Map<string, Array<[number, number]>>();
  const add = (id: string, lo: number, hi = lo) => {
    const list = out.get(id);
    if (list) list.push([lo, hi]);
  };
  for (const [id, rp] of plan.runs)
    out.set(id, [
      [0, 0],
      [rp.length, rp.length],
    ]);
  for (const rp of plan.runs.values()) {
    for (const atStart of [true, false]) {
      const e = endPlan(plan, rp, atStart);
      const isJoined = (e.kind === "junction" || e.kind === "seam") && plan.runs.has(e.parent);
      if (!isJoined) continue;
      add(e.parent, nodeS(plan.runs.get(e.parent)!, e.parentNodeIndex));
    }
  }
  for (const c of plan.crossings) {
    add(c.upper, c.sUpper);
    add(c.lower, c.sLower);
  }
  for (const p of plan.pairs) {
    add(p.a, p.sa);
    add(p.b, p.sb);
  }
  for (const [id, rp] of plan.runs) {
    if (rp.over) add(id, rp.over.p0, rp.over.p1);
    for (const z of rp.zones) {
      if (z.from > 0) add(id, z.from);
      if (z.to < rp.length) add(id, z.to);
    }
    if (!rp.below) continue;
    for (let w = 1; w < rp.run.ways.length; w++) {
      const isPortal =
        belowStructure(plan.net, rp.run.ways[w - 1]) !== belowStructure(plan.net, rp.run.ways[w]);
      if (!isPortal) continue;
      const node = rp.chain.wayStarts[rp.chain.ways.indexOf(rp.run.ways[w])];
      add(id, nodeS(rp, node));
    }
  }
  return out;
}

/** The plan sample of a run nearest run distance s, strictly inside the run. */
function nearestSample(rp: RunPlan, s: number): number {
  const base = rp.align.s[rp.i0];
  let lo = rp.i0;
  let hi = rp.i1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rp.align.s[mid] - base <= s) lo = mid;
    else hi = mid;
  }
  const isHiNearer = rp.align.s[hi] - base - s < s - (rp.align.s[lo] - base);
  return Math.min(rp.i1 - 1, Math.max(rp.i0 + 1, isHiNearer ? hi : lo));
}

/**
 * Where the anchors go (blocks.ts header): on main lines (cls expressway, below runs included), in
 * every gap of at least 2Q between noisy stretches, at the middle of what is left once Q is taken
 * off both sides, or at equal steps of at most BLOCK_ANCHOR_SPACING when that is longer, each moved
 * to the nearest plan sample. Ramps, streets and connectors get none. Sorted by run and distance.
 */
export function anchorsOf(
  plan: Plan,
  factor: number,
  options: { quietMin?: number; spacing?: number } = {},
): AnchorPoint[] {
  const isTooLow = !(factor >= 1);
  if (isTooLow) throw new Error(`the quiet factor k must be at least 1 (got ${factor})`);
  const quietMin = options.quietMin ?? BLOCK_QUIET_MIN.value;
  const spacing = options.spacing ?? BLOCK_ANCHOR_SPACING.value;
  const noisy = noisyStretches(plan);
  const out: AnchorPoint[] = [];
  for (const id of [...plan.runs.keys()].sort()) {
    const rp = plan.runs.get(id)!;
    const isMain = rp.cls === "expressway";
    if (!isMain) continue;
    const q = quietMargin(rp, factor, quietMin);
    const stretches = noisy.get(id)!.sort((p, r) => p[0] - r[0] || p[1] - r[1]);
    const merged: Array<[number, number]> = [];
    for (const [lo, hi] of stretches) {
      const last = merged[merged.length - 1];
      const isOverlapping = last !== undefined && lo <= last[1];
      if (isOverlapping) last[1] = Math.max(last[1], hi);
      else merged.push([lo, hi]);
    }
    const samples: number[] = [];
    for (let i = 1; i < merged.length; i++) {
      const u = merged[i - 1][1];
      const v = merged[i][0];
      const isQuiet = v - u >= 2 * q;
      if (!isQuiet) continue;
      const inner = v - u - 2 * q;
      const parts = Math.max(2, Math.ceil(inner / spacing));
      for (let j = 1; j < parts; j++) samples.push(nearestSample(rp, u + q + (inner * j) / parts));
    }
    const unique = [...new Set(samples)].sort((p, r) => p - r);
    const base = rp.align.s[rp.i0];
    unique.forEach((sample, k) => out.push({ run: id, k, s: rp.align.s[sample] - base, sample, q }));
  }
  return out;
}

/** A run's zones over [a, b], moved to start at 0. */
function sliceZones(zones: Zone[], a: number, b: number, length: number): Zone[] {
  const out = zones
    .filter((z) => z.to > a && z.from < b)
    .map((z) => ({ from: Math.max(z.from, a) - a, to: Math.min(z.to, b) - a, V: z.V }));
  const isEmpty = out.length === 0;
  if (isEmpty) return [{ from: 0, to: length, V: zones[zones.length - 1].V }];
  out[0].from = 0;
  out[out.length - 1].to = length;
  return out;
}

/** A piece of a run as a run of its own: the same plan line, a sub-range of its samples. */
function pieceRun(rp: RunPlan, id: string, i0: number, i1: number): RunPlan {
  const base = rp.align.s[rp.i0];
  const a = rp.align.s[i0] - base;
  const b = rp.align.s[i1] - base;
  const length = rp.align.s[i1] - rp.align.s[i0];
  const k0 = i0 - rp.i0;
  const k1 = i1 - rp.i0 + 1;
  const o = rp.over;
  const isOver = o !== null && o.p0 >= a && o.p1 <= b;
  return {
    ...rp,
    run: { ...rp.run, id },
    i0,
    i1,
    length,
    zones: sliceZones(rp.zones, a, b, length),
    wayAt: rp.wayAt.subarray(k0, k1),
    layerAt: rp.layerAt.subarray(k0, k1),
    laneHalfAt: rp.laneHalfAt.subarray(k0, k1),
    tunnelAt: rp.tunnelAt.subarray(k0, k1),
    over: isOver
      ? {
          ...o,
          base: o.base + o.slope * a,
          g0: o.g0 - a,
          g1: o.g1 - a,
          p0: o.p0 - a,
          p1: o.p1 - a,
          t0: o.t0 - a,
          t1: o.t1 - a,
          axisAt: (s: number) => o.axisAt(s + a),
        }
      : null,
  };
}

/** The piece of a run holding run distance s (the later one exactly at an anchor). */
export function pieceAt(pieces: PieceInfo[], s: number): PieceInfo {
  let found = pieces[0];
  for (const p of pieces) if (p.a <= s) found = p;
  return found;
}

/** Runs joined end to end through seams (a viaduct and the tunnel it goes on into, a closed chain). */
export function seamGroups(plan: Plan): Map<string, string[]> {
  const root = new Map<string, string>();
  for (const id of plan.runs.keys()) root.set(id, id);
  const find = (a: string): string => {
    let r = a;
    while (root.get(r) !== r) r = root.get(r)!;
    return r;
  };
  for (const rp of plan.runs.values()) {
    for (const atStart of [true, false]) {
      const e = endPlan(plan, rp, atStart);
      const isSeam = e.kind === "seam" && plan.runs.has(e.parent);
      if (!isSeam) continue;
      const a = find(rp.run.id);
      const b = find(e.parent);
      if (a !== b) root.set(a < b ? b : a, a < b ? a : b);
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of [...plan.runs.keys()].sort()) {
    const r = find(id);
    groups.set(r, [...(groups.get(r) ?? []), id]);
  }
  const out = new Map<string, string[]>();
  for (const list of groups.values()) for (const id of list) out.set(id, list);
  return out;
}

/**
 * The plan of the pieces (blocks.ts header): every run cut at its anchors, the ends of every piece
 * given (a run's own ends with the parent moved to its piece; an anchor's as `anchor`, so endPlan
 * never looks a piece up among its parent's pieces by chain index), crossings and deck pairs moved
 * onto the pieces they lie on (not found again), and the blocks grouped as the components are.
 */
export function partitionOf(
  plan: Plan,
  factor: number,
  options: { quietMin?: number; spacing?: number } = {},
): BlockPartition {
  const quietMin = options.quietMin ?? BLOCK_QUIET_MIN.value;
  const anchors = anchorsOf(plan, factor, options);
  const byRun = new Map<string, AnchorPoint[]>();
  for (const a of anchors) byRun.set(a.run, [...(byRun.get(a.run) ?? []), a]);
  const runs = new Map<string, RunPlan>();
  const piecesOf = new Map<string, PieceInfo[]>();
  const pieceInfo = new Map<string, PieceInfo>();
  for (const id of [...plan.runs.keys()].sort()) {
    const rp = plan.runs.get(id)!;
    const cuts = byRun.get(id) ?? [];
    const isCut = cuts.length > 0;
    const bounds = [rp.i0, ...cuts.map((c) => c.sample), rp.i1];
    const base = rp.align.s[rp.i0];
    const list: PieceInfo[] = [];
    for (let k = 0; k + 1 < bounds.length; k++) {
      const pid = pieceId(id, k, isCut);
      const info = {
        id: pid,
        run: id,
        k,
        a: rp.align.s[bounds[k]] - base,
        b: rp.align.s[bounds[k + 1]] - base,
      };
      // A run that is not cut is its own piece, the very same object (no anchor: the plan itself).
      runs.set(pid, isCut ? pieceRun(rp, pid, bounds[k], bounds[k + 1]) : rp);
      list.push(info);
      pieceInfo.set(pid, info);
    }
    piecesOf.set(id, list);
  }
  const onPiece = (run: string, s: number) => {
    const p = pieceAt(piecesOf.get(run)!, s);
    return { id: p.id, s: s - p.a };
  };
  const ends = new Map<string, [EndPlan, EndPlan]>();
  for (const [id, list] of piecesOf) {
    const rp = plan.runs.get(id)!;
    const mapped = (atStart: boolean): EndPlan => {
      const e = endPlan(plan, rp, atStart);
      const isJoined = (e.kind === "junction" || e.kind === "seam") && plan.runs.has(e.parent);
      if (!isJoined) return e;
      const parent = onPiece(e.parent, nodeS(plan.runs.get(e.parent)!, e.parentNodeIndex));
      return { ...e, parent: parent.id };
    };
    list.forEach((p, k) => {
      const isFirst = k === 0;
      const isLast = k === list.length - 1;
      ends.set(p.id, [
        isFirst ? mapped(true) : { kind: "anchor", run: id, s: p.a },
        isLast ? mapped(false) : { kind: "anchor", run: id, s: p.b },
      ]);
    });
  }
  const mapCrossing = (c: Plan["crossings"][number]) => {
    const up = onPiece(c.upper, c.sUpper);
    const low = onPiece(c.lower, c.sLower);
    return { upper: up.id, lower: low.id, sUpper: up.s, sLower: low.s, sinAngle: c.sinAngle };
  };
  const mapPair = (p: DeckPair): DeckPair => {
    const a = onPiece(p.a, p.sa);
    const b = onPiece(p.b, p.sb);
    return { ...p, a: a.id, sa: a.s, b: b.id, sb: b.s };
  };
  const chainRuns = new Map<string, RunPlan[]>();
  for (const [chain, list] of plan.chainRuns)
    chainRuns.set(
      chain,
      list.flatMap((rp) => piecesOf.get(rp.run.id)?.map((p) => runs.get(p.id)!) ?? []),
    );
  const pieces: Plan = {
    ...plan,
    runs,
    needed: [],
    wanted: new Set([...plan.wanted].flatMap((id) => piecesOf.get(id)!.map((p) => p.id))),
    crossings: plan.crossings.map(mapCrossing),
    ambiguous: plan.ambiguous.map(mapCrossing),
    pairs: plan.pairs.map(mapPair),
    components: new Map(),
    componentOf: new Map(),
    chainRuns,
    ends,
    partition: undefined,
    pieceRuns: new Map([...pieceInfo].map(([id, p]) => [id, { run: p.run, a: p.a }])),
  };
  groupComponents(pieces);
  const neededBlocks = [...new Set([...pieces.wanted].map((pid) => pieces.componentOf.get(pid)!))].sort();
  const neededPieces = neededBlocks.flatMap((b) => pieces.components.get(b)!);
  pieces.needed = [...neededPieces].sort();
  const solvedRuns = new Set(neededPieces.map((pid) => pieceInfo.get(pid)!.run));
  const seams = seamGroups(plan);
  const groups = new Map<string, string[]>();
  for (const id of solvedRuns) {
    const isAnchored = byRun.has(id);
    if (!isAnchored) continue;
    const group = seams.get(id)!;
    groups.set(group[0], group);
  }
  const routeGroups = [...groups.keys()].sort().map((k) => groups.get(k)!);
  const neededRuns = [...new Set([...solvedRuns, ...routeGroups.flat()])].sort();
  return {
    quietFactor: factor,
    quietMinM: quietMin,
    anchors,
    pieces,
    piecesOf,
    pieceInfo,
    neededBlocks,
    neededRuns,
    routeGroups,
  };
}
