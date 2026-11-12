import { CLEARANCE_HEIGHT } from "../law/roadStandards";
import {
  DEM_SINK_FLOOR,
  GIRDER_DEPTH,
  GIRDER_MIN,
  HEIGHT_STRUCTURES,
  LOW_SPAN_SOFFIT_MIN,
  OPEN_GROUND_FLOOR,
} from "./assumptions";
import {
  BLOCKED_STRIDE,
  CROSS_STRIDE,
  PIER_STRIDE,
  ST,
  STATION_STRIDE,
  type XwChunk,
  type XwPortal,
} from "./format";
import { surfaceAt } from "./profile";

/**
 * The structure of a viaduct-tagged run from its solved height (P2.7-6 PR 1, `--structures height`):
 * OSM's bridge tag says what the road was meant to be, the solved profile against the ground says what
 * it is. A road under the ground at its centre line is a cut (P9's retaining walls and terrain hole);
 * over the ground but under the open-ground floor (OPEN_GROUND_FLOOR under the standard girder) an
 * embankment (walls from the slab's edges down to the ground, no piers); above that a viaduct. The
 * compiler classifies every metre and merges stretches shorter than HEIGHT_STRUCTURES.smoothM into their
 * neighbours; T13 recomputes the classes from the tiles' stations (z and ground, the same thresholds).
 * Why the station's own ground and not the highest ground across the deck (the instruction's 「地表の
 * 最高点」): the tiles carry only that, and T13 must judge the chunks from the tiles alone. Pure.
 */

export type HeightClass = "viaduct" | "embankment" | "cut";

/** Road over the ground at which a deck is a viaduct: the open-ground floor under the standard girder. */
export const VIADUCT_OVER_GROUND_M = OPEN_GROUND_FLOOR.value + GIRDER_DEPTH.value;

/**
 * The dead band at both thresholds: a road this far under the ground at its centre line is still
 * the ground's (the smoothed DEM's bumps, a ground end's band), and a deck this far under the
 * viaduct's height still a viaduct. Why DEM_SINK_FLOOR: the solve lets a deck sit that far in the
 * DEM near a low end by design; with no band 28 of the first build's 36 cuts were ground ends 0.25 m
 * deep or less (PR 1 review C2), and the DEM's bumps made embankments in the air (W3).
 */
export const HEIGHT_DEAD_BAND_M = DEM_SINK_FLOOR.value;
/**
 * A cut from here down (the road over the ground at its centre line, m): past the floor the solve
 * gives (DEM_SINK_FLOOR), only a run that gave up its floor goes this deep (PR 1 re-review R2).
 */
export const CUT_BELOW_M = -HEIGHT_STRUCTURES.value.cut.fromM;
/** A viaduct from here up. */
export const VIADUCT_FROM_M = VIADUCT_OVER_GROUND_M - HEIGHT_DEAD_BAND_M;

/** A station's class from its road surface z and the ground under its centre line (T.P. m). */
export function heightClassOf(z: number, ground: number, cutBelow = CUT_BELOW_M): HeightClass {
  const over = z - ground;
  const isUnder = over < cutBelow;
  if (isUnder) return "cut";
  const isLow = over < VIADUCT_FROM_M;
  if (isLow) return "embankment";
  return "viaduct";
}

/** The classes a station may count as when the files' rounding (z 1 mm, ground 1 cm) puts it within `tol` of a threshold. */
export function heightClassesNear(z: number, ground: number, tol: number): HeightClass[] {
  const out = new Set<HeightClass>([heightClassOf(z, ground)]);
  out.add(heightClassOf(z + tol, ground));
  out.add(heightClassOf(z - tol, ground));
  return [...out];
}

export type HeightStretch = { s0: number; s1: number; structure: HeightClass };

/**
 * What besides its height decides a run's stretches: `above`, where its carriageway is over another
 * run's (the chunks' `decks` "above"): a viaduct there whatever its height, as no embankment may stand
 * on another deck (review W2); `same`, where it shares a surface with another run (`decks` "same"):
 * no cut there, the pair is one slab (review C2); `length`, the run's.
 */
export type StretchContext = {
  above?: ReadonlyArray<readonly [number, number]>;
  same?: ReadonlyArray<readonly [number, number]>;
  length?: number;
  /**
   * A ground run's cut threshold (S6 PR 2): under the ground + HEIGHT_STRUCTURES.ground.cutBelowM it is
   * a cut (the terrain cut away and walls), above it an embankment; CUT_BELOW_M otherwise.
   */
  cutBelow?: number;
  /**
   * Which of the run's ends meet the ground (S6 PR 7a, R4): a ground end, a portal, or a seam onto a run
   * at grade. An embankment 3 m or more up holds to an end only where it meets the ground there; both
   * when absent (the tags' build, PR 1's rule: any end).
   */
  groundEnds?: readonly [boolean, boolean];
  /** Counts the embankments made viaducts because the end they hold to does not meet the ground (R4). */
  unanchored?: { count: number };
};

/** An embankment reaches the ground when its lowest point is under this over the ground (review W3). */
export const EMBANKMENT_REACH_M = 3;

const isIn = (list: ReadonlyArray<readonly [number, number]> | undefined, s: number) =>
  (list ?? []).some(([a, b]) => s >= a && s <= b);

/**
 * The stretches of a run from its samples (run distance ascending, every metre or so): each sample's
 * class (heightClassOf, then `ctx`), consecutive samples of one class a stretch, and a stretch shorter
 * than `smoothM` takes the class of its longer neighbour (the one before on a tie), the shortest first,
 * until none is left. A cut is never merged away: past the dead band it is the road's, not a bump's
 * (review S1). Then an embankment that never comes down near the ground (its lowest point
 * EMBANKMENT_REACH_M or more over it) and touches neither end of the run is a viaduct after all: a
 * deck in the air over the DEM's bumps (review W3; the ledger lists it as low-viaduct). Why the longer
 * neighbour: the class of a few metres between two long stretches is the DEM's bump, not the road's.
 */
export function heightStretches(
  samples: ReadonlyArray<{ s: number; z: number; ground: number }>,
  smoothM = HEIGHT_STRUCTURES.value.smoothM,
  ctx: StretchContext = {},
): HeightStretch[] {
  const isEmpty = samples.length === 0;
  if (isEmpty) return [];
  const length = ctx.length ?? samples[samples.length - 1].s;
  const classOf = (p: { s: number; z: number; ground: number }): HeightClass => {
    if (isIn(ctx.above, p.s)) return "viaduct";
    const cls = heightClassOf(p.z, p.ground, ctx.cutBelow);
    const isSameCut = cls === "cut" && isIn(ctx.same, p.s);
    return isSameCut ? "embankment" : cls;
  };
  type Open = HeightStretch & { low: number };
  const out: Open[] = [];
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    const cls = classOf(p);
    const last = out[out.length - 1];
    const isSame = last !== undefined && last.structure === cls;
    if (isSame) {
      last.s1 = p.s;
      last.low = Math.min(last.low, p.z - p.ground);
      continue;
    }
    // The boundary halfway between the two samples.
    const at = i === 0 ? p.s : (samples[i - 1].s + p.s) / 2;
    if (last) last.s1 = at;
    out.push({ s0: at, s1: p.s, structure: cls, low: p.z - p.ground });
  }
  out[out.length - 1].s1 = samples[samples.length - 1].s;
  // Two neighbours of one class that touch: one stretch.
  const join = () => {
    for (let i = out.length - 1; i > 0; i--) {
      const isJoined = out[i].structure === out[i - 1].structure;
      if (!isJoined) continue;
      out[i - 1].s1 = out[i].s1;
      out[i - 1].low = Math.min(out[i - 1].low, out[i].low);
      out.splice(i, 1);
    }
  };
  for (;;) {
    const isSingle = out.length <= 1;
    if (isSingle) break;
    let k = -1;
    // A cut neither merges nor takes in its neighbour: an embankment of a few metres beside a cut
    // turned the cut longer than the road is under the ground (27155734's ground end).
    // A cut shorter than HEIGHT_STRUCTURES.cut.minLengthM is a bump's and merges as the others (R2).
    const isFirmCut = (h: HeightStretch) =>
      h.structure === "cut" && h.s1 - h.s0 >= HEIGHT_STRUCTURES.value.cut.minLengthM;
    // Between two cuts a short stretch has no taker but them, and takes the longer cut's class:
    // a 1 m embankment between two cuts of a ramp at grade (169674665:3) was a chunk of its own.
    const isWedged = (i: number) =>
      out[i - 1]?.structure === "cut" && out[i + 1]?.structure === "cut" && out[i].structure !== "cut";
    const isTaker = (h: HeightStretch | undefined, i?: number) =>
      h !== undefined && (h.structure !== "cut" || (i !== undefined && isWedged(i)));
    for (let i = 0; i < out.length; i++) {
      const len = out[i].s1 - out[i].s0;
      const hasTaker = isTaker(out[i - 1], i) || isTaker(out[i + 1], i);
      const isShort = len < smoothM && !isFirmCut(out[i]) && hasTaker;
      const isShorter = k < 0 || len < out[k].s1 - out[k].s0;
      if (isShort && isShorter) k = i;
    }
    if (k < 0) break;
    const before = out[k - 1];
    const after = out[k + 1];
    const lenOf = (h: HeightStretch | undefined) => (isTaker(h, k) ? h!.s1 - h!.s0 : -1);
    const into = lenOf(before) >= lenOf(after) ? before! : after!;
    if (into === before) before.s1 = out[k].s1;
    else after.s0 = out[k].s0;
    out.splice(k, 1);
    join();
  }
  for (const h of out) {
    const [startGround, endGround] = ctx.groundEnds ?? [true, true];
    const isAnchored = (h.s0 <= 1e-6 && startGround) || (h.s1 >= length - 1e-6 && endGround);
    const isFloating = h.structure === "embankment" && h.low >= EMBANKMENT_REACH_M && !isAnchored;
    const isAtEnd = h.s0 <= 1e-6 || h.s1 >= length - 1e-6;
    if (isFloating && isAtEnd && ctx.unanchored) ctx.unanchored.count++;
    if (isFloating) h.structure = "viaduct";
  }
  join();
  return out.map(({ s0, s1, structure }) => ({ s0, s1, structure }));
}

/** The class of run distance s among a run's stretches (the later one on a boundary). */
export function heightClassAt(stretches: readonly HeightStretch[], s: number): HeightClass {
  let found = stretches[0]?.structure ?? "viaduct";
  for (const h of stretches) if (s >= h.s0) found = h.structure;
  return found;
}

/**
 * The girder a viaduct chunk takes from what it must clear under it (P2.7-6 PR 1): `surpluses` are, per
 * thing crossed, the height of the road surface over it less 第12条's H (a road, another deck) or the
 * railway's clearance. Every surplus under GIRDER_DEPTH and at least GIRDER_MIN thins the girder to it;
 * one under GIRDER_MIN is a miss no thinner girder takes (the judgement reports it), so it is left out.
 */
export function girderFor(surpluses: readonly number[]): number {
  let girder = GIRDER_DEPTH.value;
  for (const v of surpluses) {
    const isThinnable = v < girder && v >= GIRDER_MIN.value - 1e-9;
    if (isThinnable) girder = v;
  }
  return girder;
}

/** How far a crossing may miss the clearance + GIRDER_DEPTH and still pass on a thinner girder. */
export const GIRDER_GIVE_M = GIRDER_DEPTH.value - GIRDER_MIN.value;

/** The clearance a deck over another must keep: 第12条's H and the upper deck's girder (its chunk's, standard when it has none). */
export function levelApartOver(upperGirder: number): number {
  const girder = upperGirder > 0 ? Math.min(upperGirder, GIRDER_DEPTH.value) : GIRDER_DEPTH.value;
  return CLEARANCE_HEIGHT.value + girder;
}

/** An embankment or cut stretch of a run's chunks: consecutive chunks of one of them, its extent and depth. */
export type OpenGroundStretch = {
  run: string;
  /** The first chunk of the stretch. */
  chunk: string;
  structure: "embankment" | "cut";
  s0: number;
  s1: number;
  lengthM: number;
  /** The deepest station under the ground at its centre line (0 for an embankment). */
  depthM: number;
};

/**
 * A height build's embankment and cut stretches of one viaduct-tagged run (its chunks in k order), from
 * the chunks alone: the scorecard's distribution and the ledger's cut-stretch / embankment-stretch. A
 * below run (all tunnel or cut, or with a tunnel) and a structure's run have none.
 */
export function openGroundStretches(list: readonly XwChunk[], isBelow?: boolean): OpenGroundStretch[] {
  const isEmpty = list.length === 0;
  if (isEmpty) return [];
  if (!isClassified(list, isBelow)) return [];
  const out: OpenGroundStretch[] = [];
  for (const c of list) {
    const isOpen = c.structure === "embankment" || c.structure === "cut";
    if (!isOpen) continue;
    const s0 = c.st[0];
    const s1 = c.st[c.st.length - STATION_STRIDE];
    // How deep under the ground at its centre line: a cut's, and an embankment's too (a same-surface
    // stretch kept as one, PR 1 re-review R1).
    let depth = 0;
    for (let i = 0; i < c.st.length; i += STATION_STRIDE)
      depth = Math.max(depth, c.st[i + ST.ground] - c.st[i + ST.z]);
    const last = out[out.length - 1];
    const isContinued =
      last !== undefined && last.structure === c.structure && Math.abs(last.s1 - s0) < 0.011;
    if (isContinued) {
      last.s1 = s1;
      last.lengthM = Math.round((s1 - last.s0) * 100) / 100;
      last.depthM = Math.max(last.depthM, Math.round(depth * 100) / 100);
      continue;
    }
    out.push({
      run: c.run,
      chunk: c.id,
      structure: c.structure as "embankment" | "cut",
      s0,
      s1,
      lengthM: Math.round((s1 - s0) * 100) / 100,
      depthM: Math.round(depth * 100) / 100,
    });
  }
  return out;
}

/**
 * A height build's viaduct stretches under the viaduct's height (VIADUCT_FROM_M) for HEIGHT_STRUCTURES'
 * smoothing length or more, off the decks it stands over: the embankments in the air heightStretches
 * keeps as viaducts (review W3), for the ledger's low-viaduct (each listed for a review). `lowM` its
 * lowest height over the ground.
 */
export function lowViaductStretches(
  list: readonly XwChunk[],
  isBelow?: boolean,
): Array<{ chunk: string; s0: number; s1: number; lengthM: number; lowM: number }> {
  const isEmpty = list.length === 0;
  if (isEmpty || !isClassified(list, isBelow)) return [];
  const above = deckSpans(list, "above");
  const out: Array<{ chunk: string; s0: number; s1: number; lengthM: number; lowM: number }> = [];
  let open: (typeof out)[number] | null = null;
  const close = () => {
    const isLong = open !== null && open.lengthM >= HEIGHT_STRUCTURES.value.smoothM;
    if (isLong) out.push(open!);
    open = null;
  };
  for (const c of list) {
    const isViaduct = c.structure === "viaduct";
    for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
      const s = c.st[i + ST.s];
      const over = c.st[i + ST.z] - c.st[i + ST.ground];
      const isLow = isViaduct && over < VIADUCT_FROM_M && !isIn(above, s);
      if (!isLow) {
        close();
        continue;
      }
      if (open === null) open = { chunk: c.id, s0: s, s1: s, lengthM: 0, lowM: over };
      open.s1 = s;
      open.lengthM = Math.round((s - open.s0) * 100) / 100;
      open.lowM = Math.min(open.lowM, Math.round(over * 100) / 100);
    }
  }
  close();
  return out;
}

/**
 * Whether a rule accepts an open-ground stretch without a review (HEIGHT_STRUCTURES): a cut no deeper
 * nor longer than its limits (the approach to a tunnel's portal), an embankment no longer than its.
 */
export function isOpenGroundRuled(h: Pick<OpenGroundStretch, "structure" | "lengthM" | "depthM">): boolean {
  const { cut, embankment } = HEIGHT_STRUCTURES.value;
  // An embankment under the ground past the dead band is listed (R1: same-surface stretches 2.77 m down).
  if (h.structure === "embankment") return h.lengthM <= embankment.lengthM && h.depthM <= HEIGHT_DEAD_BAND_M;
  return h.lengthM <= cut.lengthM && h.depthM <= cut.depthM;
}

/**
 * Whether a run's chunks were classified by height: not a below run (its summary's `below`, a height
 * build's; without it, a run of tunnels and cuts only or with a tunnel, as before review W5: a
 * viaduct-tagged run that became all cut looked like one) nor a structure's run.
 */
export function isClassified(list: readonly XwChunk[], isBelow?: boolean): boolean {
  const isOnStructure = list.some((c) => c.over !== null);
  if (isOnStructure) return false;
  if (isBelow !== undefined) return !isBelow;
  const isBelowRun = list.every((c) => c.structure === "tunnel" || c.structure === "cut");
  const isTunnelRun = list.some((c) => c.structure === "tunnel");
  return !isBelowRun && !isTunnelRun;
}

/** A run's stretches of `decks` of one relation (run distances), for heightStretches' context. */
export function deckSpans(list: readonly XwChunk[], relation: "above" | "same"): Array<[number, number]> {
  return list.flatMap((c) =>
    c.decks.filter((d) => d.relation === relation).map((d): [number, number] => [d.s0, d.s1]),
  );
}

/** The rounding of the files T13 allows at a threshold (z 1 mm, ground 1 cm). */
const T13_TOLERANCE_M = 0.02;
/** The widest half window a crossing takes along the deck (compile.ts: 40 m at most). */
const T13_CROSS_WINDOW_M = 40;

/**
 * T13 (P2.7-6 PR 1): a height build's viaduct-tagged run, from its chunks alone (k order). Every station
 * is of its chunk's structure by the thresholds of heightClassOf, except stretches of stations shorter
 * than HEIGHT_STRUCTURES.smoothM (what the compiler merges); an embankment or cut chunk has no piers and
 * crosses nothing; a cut chunk has no girder; and where the structure changes between two chunks the
 * later one starts with a portal from the one before. `isBelowRun`: a below run (P9's tunnels and cuts by
 * their tags) is not judged here. Returns the violations ("<chunk>: what").
 */
export function checkHeightStructures(
  list: readonly XwChunk[],
  isBelow?: boolean,
  isGround = false,
  /**
   * Which of the run's ends meet the ground (a ground end, a portal, a seam onto a run at grade: the
   * run summaries'), for R4: an embankment chunk stretch EMBANKMENT_REACH_M or more up throughout that
   * holds to neither is a deck in the air. Absent: both (the rule before R4).
   */
  groundEnds: readonly [boolean, boolean] = [true, true],
): string[] {
  const out: string[] = [];
  const isEmpty = list.length === 0;
  if (isEmpty) return out;
  if (!isClassified(list, isBelow)) return out;
  const smooth = HEIGHT_STRUCTURES.value.smoothM;
  // Independent of the compiler's classifier (S6 PR 7a, R6 (a): it called heightStretches, the same
  // rules recomputed): from the files' values and the assumptions' thresholds alone, every metre the
  // classes a station may be, and a run of stations its chunk's structure is not over smoothM or
  // more is a violation. Every metre: the surface (profile.ts) and the ground linear between stations.
  const cutBelow = isGround ? HEIGHT_STRUCTURES.value.ground.cutBelowM : -HEIGHT_STRUCTURES.value.cut.fromM;
  const viaductFrom = VIADUCT_OVER_GROUND_M - DEM_SINK_FLOOR.value;
  const above = deckSpans(list, "above");
  const same = deckSpans(list, "same");
  // A road or railway the deck crosses (`cross`) over its window (the chunk's `crossWindows`, review W6;
  // T13_CROSS_WINDOW_M, the widest, where the files carry none): the window is spanned (R3).
  const windows = list.flatMap((c) => {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < c.cross.length; i += CROSS_STRIDE) {
      const half = c.crossWindows?.[i / CROSS_STRIDE] ?? T13_CROSS_WINDOW_M;
      out.push([c.cross[i] - half, c.cross[i] + half]);
    }
    return out;
  });
  // A low span's window over a blocked road (S6 PR 7a2, `blockedWindows`) is spanned too.
  windows.push(...lowSpanWindows(list));
  const isIn = (spans: Array<[number, number]>, s: number) => spans.some(([a, b]) => s >= a && s <= b);
  // Every metre's height over the ground, in k order.
  const pts: Array<{ s: number; over: number; k: number; first: boolean }> = [];
  list.forEach((c, k) => {
    const a = c.st[0];
    const b = c.st[c.st.length - STATION_STRIDE];
    for (let s = k === 0 ? a : Math.ceil(a); s <= b + 1e-9; s += 1) {
      let i = 0;
      while (i + 2 * STATION_STRIDE <= c.st.length && c.st[i + STATION_STRIDE] < s) i += STATION_STRIDE;
      const j = Math.min(i + STATION_STRIDE, c.st.length - STATION_STRIDE);
      const t = c.st[j] > c.st[i] ? (s - c.st[i]) / (c.st[j] - c.st[i]) : 0;
      const g = c.st[i + ST.ground] + (c.st[j + ST.ground] - c.st[i + ST.ground]) * t;
      pts.push({ s, over: surfaceAt(c.st, s).z - g, k, first: s - a < 1 });
    }
  });
  // A stretch under the viaduct's height that never comes within EMBANKMENT_REACH_M of the ground may
  // be drawn as a viaduct (the floating embankment). Why by stretch and not by station: a station 3 m
  // up on an embankment that reaches the ground elsewhere is the embankment's.
  const floating = new Uint8Array(pts.length);
  // Over another deck a station is the viaduct's whatever its height, so it ends a stretch (as the
  // compiler's classes do: 780870438:0's deck over 28127318 at its seam, 1.5 m up).
  // A spanned window ends one too (S6 PR 7a2): the compiler rules the pieces left beside a window apart
  // (afterSpanning). Read through the window, a piece 3 m up on its far side would make one stretch
  // with the embankment on its low side that reaches the ground, and be judged an embankment.
  const isLowAt = (q: number) =>
    pts[q].over < viaductFrom + T13_TOLERANCE_M && !isIn(above, pts[q].s) && !isIn(windows, pts[q].s);
  for (let i = 0; i < pts.length;) {
    if (!isLowAt(i)) {
      i++;
      continue;
    }
    let j = i;
    let low = Infinity;
    while (j < pts.length && isLowAt(j)) low = Math.min(low, pts[j++].over);
    const isFloating = low >= EMBANKMENT_REACH_M - T13_TOLERANCE_M;
    if (isFloating) floating.fill(1, i, j);
    i = j;
  }
  const allowed = (s: number, over: number, isFloating: boolean): Set<HeightClass> => {
    const isAbove = isIn(above, s);
    if (isAbove) return new Set(["viaduct"]);
    const out = new Set<HeightClass>();
    const isLowest = over < cutBelow + T13_TOLERANCE_M;
    const isLow = over < viaductFrom + T13_TOLERANCE_M;
    const isHigh = over >= viaductFrom - T13_TOLERANCE_M;
    // Sharing a surface, no cut; but a station apart from its partner by more than the runtime merges
    // is classed by its height (R5), which the tiles do not carry: either.
    if (isLowest) out.add("cut");
    if (isLowest && isIn(same, s)) out.add("embankment");
    if (isLow && over >= cutBelow - T13_TOLERANCE_M) out.add("embankment");
    // A crossing's window is spanned (R3).
    const isWindow = isIn(windows, s);
    if (isHigh || isFloating || isWindow) out.add("viaduct");
    return out;
  };
  let open: { chunk: string; s0: number; s1: number } | null = null;
  const close = () => {
    const isLong = open !== null && open.s1 - open.s0 >= smooth + 1;
    if (isLong)
      out.push(
        `${open!.chunk}: stations at ${open!.s0}–${open!.s1} m are not of its structure over ${smooth} m or more`,
      );
    open = null;
  };
  list.forEach((c, k) => {
    const structure = c.structure as HeightClass;
    pts.forEach((p, q) => {
      if (p.k !== k) return;
      const may = allowed(p.s, p.over, floating[q] === 1);
      // A chunk's first metre is also the last of the one before (either may hold it).
      const prev = k > 0 && p.first ? (list[k - 1].structure as HeightClass) : null;
      const isOf = may.has(structure) || (prev !== null && may.has(prev));
      if (isOf) {
        close();
        return;
      }
      if (open === null) open = { chunk: c.id, s0: p.s, s1: p.s };
      open.s1 = p.s;
    });
    const isOpenGround = c.structure === "embankment" || c.structure === "cut";
    if (isOpenGround && c.piers.length > 0)
      out.push(`${c.id}: ${c.piers.length / PIER_STRIDE} piers on an ${c.structure}`);
    if (isOpenGround && c.cross.length > 0) out.push(`${c.id}: an ${c.structure} crosses over something`);
    if (c.structure === "cut" && c.girder !== 0) out.push(`${c.id}: a cut with a girder of ${c.girder} m`);
    const before = k > 0 ? list[k - 1] : null;
    const isChange = before !== null && before.structure !== c.structure;
    if (!isChange) return;
    const s0 = c.st[0];
    const hasPortal = (c.portals ?? []).some(
      (p: XwPortal) => Math.abs(p.s - s0) <= 0.011 && p.from === before.structure && p.to === c.structure,
    );
    if (!hasPortal) out.push(`${c.id}: no portal ${before.structure}>${c.structure} at s=${s0}`);
  });
  close();
  out.push(...checkLowSpans(list));
  // R4 (review W3): each stretch of embankment chunks, its lowest metre over the ground, and whether it
  // holds to an end that meets the ground.
  const S = pts.length > 0 ? pts[pts.length - 1].s : 0;
  for (let i = 0; i < pts.length;) {
    const isBank = (q: number) => list[pts[q].k].structure === "embankment";
    if (!isBank(i)) {
      i++;
      continue;
    }
    let j = i;
    let low = Infinity;
    while (j < pts.length && isBank(j)) low = Math.min(low, pts[j++].over);
    const s0 = pts[i].s;
    const s1 = pts[j - 1].s;
    const isAnchored = (s0 <= pts[0].s + 1 && groundEnds[0]) || (s1 >= S - 1 && groundEnds[1]);
    const isInAir = low >= EMBANKMENT_REACH_M + T13_TOLERANCE_M && !isAnchored;
    if (isInAir)
      out.push(
        `${list[pts[i].k].id}: an embankment at ${s0}–${s1} m stands ${low.toFixed(2)} m or more up, off the ground`,
      );
    i = j;
  }
  return out;
}

/**
 * The stretches with each window ([a, b], run distances) made viaduct (S6 PR 7a, R3: a crossing whose
 * window the deck clears over the thinnest girder is spanned, the embankment or cut starting at the
 * window's end), split where a window cuts a stretch and merged where two of one structure meet.
 */
export function forceViaduct(
  list: readonly HeightStretch[],
  windows: ReadonlyArray<readonly [number, number]>,
): HeightStretch[] {
  let out: HeightStretch[] = list.map((h) => ({ ...h }));
  for (const [a, b] of windows) {
    const next: HeightStretch[] = [];
    for (const h of out) {
      const isApart = h.s1 <= a || h.s0 >= b || h.structure === "viaduct";
      if (isApart) {
        next.push(h);
        continue;
      }
      if (h.s0 < a) next.push({ s0: h.s0, s1: a, structure: h.structure });
      next.push({ s0: Math.max(h.s0, a), s1: Math.min(h.s1, b), structure: "viaduct" });
      if (h.s1 > b) next.push({ s0: b, s1: h.s1, structure: h.structure });
    }
    out = next;
  }
  const merged: HeightStretch[] = [];
  for (const h of out) {
    const last = merged[merged.length - 1];
    const isSame = last !== undefined && last.structure === h.structure && Math.abs(last.s1 - h.s0) < 1e-9;
    if (isSame) last.s1 = h.s1;
    else merged.push({ ...h });
  }
  return merged;
}

/**
 * The stretches after forceViaduct (S6 PR 7a review W2), its leftovers ruled as heightStretches rules
 * them: an embankment shorter than `smoothM` between two viaducts (or a viaduct and the run's end) is
 * a viaduct, and an embankment whose lowest point stands EMBANKMENT_REACH_M or more over the ground and
 * that holds to no end meeting the ground (`groundEnds`) is a viaduct. Why again: a window cut an
 * embankment into pieces the classing had not seen (32404414:71, 9.48 m long and 6.13–6.46 m up, was
 * left an embankment in the air). Cuts are left: under the ground they are the road's.
 */
export function afterSpanning(
  list: readonly HeightStretch[],
  samples: ReadonlyArray<{ s: number; z: number; ground: number }>,
  smoothM: number,
  length: number,
  groundEnds: readonly [boolean, boolean] = [true, true],
): HeightStretch[] {
  const out = list.map((h) => ({ ...h }));
  const lowOf = (h: HeightStretch) => {
    let low = Infinity;
    for (const p of samples)
      if (p.s >= h.s0 - 1e-9 && p.s <= h.s1 + 1e-9) low = Math.min(low, p.z - p.ground);
    return low;
  };
  out.forEach((h, i) => {
    const isEmbankment = h.structure === "embankment";
    if (!isEmbankment) return;
    const atStart = h.s0 <= 1e-6;
    const atEnd = h.s1 >= length - 1e-6;
    const isSpannedBefore = atStart || out[i - 1]?.structure === "viaduct";
    const isSpannedAfter = atEnd || out[i + 1]?.structure === "viaduct";
    const isShortBetween = h.s1 - h.s0 < smoothM && isSpannedBefore && isSpannedAfter && !(atStart && atEnd);
    const isAnchored = (atStart && groundEnds[0]) || (atEnd && groundEnds[1]);
    const isFloating = lowOf(h) >= EMBANKMENT_REACH_M && !isAnchored;
    if (isShortBetween || isFloating) h.structure = "viaduct";
  });
  const merged: HeightStretch[] = [];
  for (const h of out) {
    const last = merged[merged.length - 1];
    const isSame = last !== undefined && last.structure === h.structure;
    if (isSame) last.s1 = h.s1;
    else merged.push({ ...h });
  }
  return merged;
}

/**
 * R3 (S6 PR 7a): whether a deck at its lowest over a crossing's window (`lowest`, T.P. m) clears what
 * it crosses (`top`) by its clearance with the girder (`need`) less what a girder thinner down to
 * GIRDER_MIN gives. Such a window is spanned (forceViaduct).
 */
export function clearsOnThinGirder(lowest: number, top: number, need: number): boolean {
  return lowest - top >= need - GIRDER_GIVE_M;
}

/**
 * R5 (S6 PR 7a): the same-surface spans less the stretches (`apart`, open intervals) where the pair
 * stands apart past the merge, metre by metre: what is left is one slab, the rest classed by height.
 */
export function sameKept(
  spans: ReadonlyArray<readonly [number, number]>,
  apart: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  const isApartAt = (sv: number) => apart.some(([a, b]) => sv > a && sv < b);
  return spans.flatMap(([a, b]): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    let from: number | null = null;
    for (let sv = a; sv <= b + 1e-9; sv += 1) {
      const isKept = !isApartAt(sv);
      if (isKept && from === null) from = sv;
      if (!isKept && from !== null) {
        out.push([from, sv - 1]);
        from = null;
      }
    }
    if (from !== null) out.push([from, b]);
    return out;
  });
}

/** Whether a crossing's window (centre sc, ±half) reaches a chunk's [a, b] (R6 (c): it takes the thin girder). */
export function isWindowOver(sc: number, half: number, a: number, b: number): boolean {
  return sc + half >= a && sc - half <= b;
}

/** The low spans' windows of a run's chunks (S6 PR 7a2): [s − half, s + half] per spanned blocked road. */
export function lowSpanWindows(list: readonly XwChunk[]): Array<[number, number]> {
  return list.flatMap((c) => {
    const out: Array<[number, number]> = [];
    const halves = c.blockedWindows ?? [];
    for (let i = 0; i < c.blocked.length; i += BLOCKED_STRIDE) {
      const half = halves[i / BLOCKED_STRIDE] ?? 0;
      if (half > 0) out.push([c.blocked[i] - half, c.blocked[i] + half]);
    }
    return out;
  });
}

/**
 * T13 over the low spans (S6 PR 7a2), from the files alone: every metre of a spanned window is on a
 * viaduct chunk on the thinnest girder, its soffit (the surface less that chunk's girder over the road)
 * LOW_SPAN_SOFFIT_MIN or more, and no pier stands in the window. 2 cm for the files' rounding.
 */
export function checkLowSpans(list: readonly XwChunk[]): string[] {
  const out: string[] = [];
  // A station on a chunk boundary is read on the spanning chunk's side (the window starts there).
  const holds = (c: XwChunk, sv: number) =>
    sv >= c.st[0] - 1e-9 && sv <= c.st[c.st.length - STATION_STRIDE] + 1e-9;
  const chunkAt = (sv: number) =>
    list.find((c) => c.structure === "viaduct" && holds(c, sv)) ?? list.find((c) => holds(c, sv));
  const piers = list.flatMap((c) => {
    const ps: number[] = [];
    for (let i = 0; i < c.piers.length; i += PIER_STRIDE) ps.push(c.piers[i]);
    return ps;
  });
  for (const c of list) {
    const halves = c.blockedWindows ?? [];
    for (let i = 0; i < c.blocked.length; i += BLOCKED_STRIDE) {
      const half = halves[i / BLOCKED_STRIDE] ?? 0;
      if (half <= 0) continue;
      const [sc, top] = c.blocked.slice(i, i + BLOCKED_STRIDE);
      const label = `${c.id}: the low span over the road at s=${sc}`;
      const pier = piers.find((p) => Math.abs(p - sc) <= half);
      if (pier !== undefined) out.push(`${label} has a pier at s=${pier}`);
      for (let sv = Math.ceil(sc - half); sv <= sc + half + 1e-9; sv += 1) {
        const at = chunkAt(sv);
        if (at === undefined) continue;
        const isSpanned = at.structure === "viaduct" && at.girder <= GIRDER_MIN.value + 1e-9;
        if (!isSpanned) {
          out.push(`${label} is on ${at.id}'s ${at.structure} (girder ${at.girder}) at s=${sv}`);
          break;
        }
        const soffit = surfaceAt(at.st, sv).z - at.girder - top;
        const isLow = soffit < LOW_SPAN_SOFFIT_MIN.value - 0.02;
        if (isLow) {
          out.push(`${label} is ${soffit.toFixed(2)} m over it at s=${sv}`);
          break;
        }
      }
    }
  }
  return out;
}

/**
 * S6 PR 7a2: whether a blocked road's window [a, b] is spanned low: its soffit (the deck's lowest over
 * it less GIRDER_MIN, over the road) `least` or more, and the window on an embankment and no cut (a cut
 * is level with the road: nothing to span).
 */
export function isLowSpanWindow(
  stretches: readonly HeightStretch[],
  a: number,
  b: number,
  soffit: number,
  least: number,
): boolean {
  const touches = (cls: HeightClass) => stretches.some((h) => h.structure === cls && h.s1 > a && h.s0 < b);
  const isHighEnough = soffit >= least;
  return isHighEnough && touches("embankment") && !touches("cut");
}
