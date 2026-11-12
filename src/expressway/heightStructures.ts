import { CLEARANCE_HEIGHT } from "../law/roadStandards";
import {
  DEM_SINK_FLOOR,
  GIRDER_DEPTH,
  GIRDER_MIN,
  HEIGHT_STRUCTURES,
  OPEN_GROUND_FLOOR,
} from "./assumptions";
import { PIER_STRIDE, ST, STATION_STRIDE, type XwChunk, type XwPortal } from "./format";
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
/** A cut from here down (the road over the ground at its centre line, m). */
export const CUT_BELOW_M = -HEIGHT_DEAD_BAND_M;
/** A viaduct from here up. */
export const VIADUCT_FROM_M = VIADUCT_OVER_GROUND_M - HEIGHT_DEAD_BAND_M;

/** A station's class from its road surface z and the ground under its centre line (T.P. m). */
export function heightClassOf(z: number, ground: number): HeightClass {
  const over = z - ground;
  const isUnder = over < CUT_BELOW_M;
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
    const cls = heightClassOf(p.z, p.ground);
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
    const isTaker = (h: HeightStretch | undefined) => h !== undefined && h.structure !== "cut";
    for (let i = 0; i < out.length; i++) {
      const len = out[i].s1 - out[i].s0;
      const hasTaker = isTaker(out[i - 1]) || isTaker(out[i + 1]);
      const isShort = len < smoothM && out[i].structure !== "cut" && hasTaker;
      const isShorter = k < 0 || len < out[k].s1 - out[k].s0;
      if (isShort && isShorter) k = i;
    }
    if (k < 0) break;
    const before = out[k - 1];
    const after = out[k + 1];
    const lenOf = (h: HeightStretch | undefined) => (isTaker(h) ? h!.s1 - h!.s0 : -1);
    const into = lenOf(before) >= lenOf(after) ? before! : after!;
    if (into === before) before.s1 = out[k].s1;
    else after.s0 = out[k].s0;
    out.splice(k, 1);
    join();
  }
  for (const h of out) {
    const isFloating =
      h.structure === "embankment" && h.low >= EMBANKMENT_REACH_M && h.s0 > 1e-6 && h.s1 < length - 1e-6;
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
      depthM: c.structure === "cut" ? Math.round(depth * 100) / 100 : 0,
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
  if (h.structure === "embankment") return h.lengthM <= embankment.lengthM;
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

/**
 * T13 (P2.7-6 PR 1): a height build's viaduct-tagged run, from its chunks alone (k order). Every station
 * is of its chunk's structure by the thresholds of heightClassOf, except stretches of stations shorter
 * than HEIGHT_STRUCTURES.smoothM (what the compiler merges); an embankment or cut chunk has no piers and
 * crosses nothing; a cut chunk has no girder; and where the structure changes between two chunks the
 * later one starts with a portal from the one before. `isBelowRun`: a below run (P9's tunnels and cuts by
 * their tags) is not judged here. Returns the violations ("<chunk>: what").
 */
export function checkHeightStructures(list: readonly XwChunk[], isBelow?: boolean): string[] {
  const out: string[] = [];
  const isEmpty = list.length === 0;
  if (isEmpty) return out;
  if (!isClassified(list, isBelow)) return out;
  const smooth = HEIGHT_STRUCTURES.value.smoothM;
  // The stretches the compiler's rules give over the files' stations (the decks, the dead bands, the
  // smoothing, the embankments in the air), at the rounding either way.
  // Every metre, as the compiler classifies: the surface (profile.ts) and the ground linear between
  // stations. Why not the stations alone: 20 m apart, a 5 m deck "above" took a whole station's
  // share and was no longer merged away (45021976:0 in the review's rebuild).
  const samples: Array<{ s: number; z: number; ground: number }> = [];
  for (const c of list) {
    const a = c.st[0];
    const b = c.st[c.st.length - STATION_STRIDE];
    for (let s = samples.length === 0 ? a : Math.ceil(a); s <= b + 1e-9; s += 1) {
      let i = 0;
      while (i + 2 * STATION_STRIDE <= c.st.length && c.st[i + STATION_STRIDE] < s) i += STATION_STRIDE;
      const g0 = c.st[i + ST.ground];
      const g1 = c.st[Math.min(i + STATION_STRIDE, c.st.length - STATION_STRIDE) + ST.ground];
      const s0 = c.st[i];
      const s1 = c.st[Math.min(i + STATION_STRIDE, c.st.length - STATION_STRIDE)];
      const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
      samples.push({ s, z: surfaceAt(c.st, s).z, ground: g0 + (g1 - g0) * t });
    }
  }
  const ctx: StretchContext = {
    above: deckSpans(list, "above"),
    same: deckSpans(list, "same"),
    length: samples[samples.length - 1].s,
  };
  const variants = [0, T13_TOLERANCE_M, -T13_TOLERANCE_M].map((d) =>
    heightStretches(
      samples.map((p) => ({ ...p, z: p.z + d })),
      smooth,
      ctx,
    ),
  );
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
    const n = c.st.length / STATION_STRIDE;
    for (let i = 0; i < n; i++) {
      const o = i * STATION_STRIDE;
      const s = c.st[o + ST.s];
      const near = variants.map((v) => heightClassAt(v, s));
      // A chunk's first station is also the last of the one before (either may hold it).
      const prev = k > 0 && i === 0 ? (list[k - 1].structure as HeightClass) : null;
      const isOf = near.includes(structure) || (prev !== null && near.includes(prev));
      if (isOf) {
        close();
        continue;
      }
      if (open === null) open = { chunk: c.id, s0: s, s1: s };
      open.s1 = s;
    }
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
  return out;
}
