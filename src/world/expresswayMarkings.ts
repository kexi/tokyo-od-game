import { BRANCH_LINE, LANE_LINE_DASH, ZEBRA } from "../expressway/assumptions";
import type { XwChunk, XwRunSummary } from "../expressway/format";
import { MARKING_DIMENSIONS } from "../law/roadStandards";
import { sectionWidth } from "./laneChange";
import type { MarkingColour } from "./roadMarkings";

/**
 * What stands and what is painted at each side of an expressway deck where it meets another deck
 * (knowledge/road-redesign-plan.md 4.2 and 4.7, P3 and P3.5). Pure: no three.js, so the tests and
 * the deck builder read the same plan.
 *
 * Decks of different runs lie side by side or over one another at every 分合流 and where the two
 * directions of C1 run as one structure. The compiler records which (`XwChunk.decks`); DeckIndex
 * answers, for a ring of a deck, the runs it shares one surface with there, and expresswayMerge.ts
 * makes the pair one slab and fills in each side of the ring (DeckSide): where the road ends, which
 * 壁高欄 stand, and how the other deck's lanes lie.
 *
 * The plan (planDeckMarkings) follows from the same sides:
 * - 車道外側線 (103): white solid at each edge of the lanes (inside the shoulders), 0.20 m.
 * - 車線境界線 (102): white dashed between the lanes, LANE_LINE_DASH, 0.15 m.
 * - 分合流部 (別表第四): where a ramp's lanes meet the main line's, the main line's edge line becomes
 *   the thick dashed BRANCH_LINE and the ramp's edge line on that side goes (its lane continues
 *   into the main line's).
 * - 導流帯 (107): where the two decks are one slab but their lanes are still apart (the nose), the
 *   strip between them, painted by the deck that is cut, from its lane edge to the master's.
 * A line is painted only where it lies on the deck's own road (a cut deck's lines stop at the
 * master's edge: the master's own lines are the ones on its face). Yellow lines (進路変更禁止) are
 * not painted: there is no data for them (設計書 4.7).
 */

/** Lanes closer than this to the other deck's lanes are treated as meeting (no strip to stripe). */
const ZEBRA_MIN_GAP = 0.3;
/** 車道外側線 width on the expressway (標識令 別表第四 103: 0.15–0.20 m, the upper value). */
export const XW_EDGE_WIDTH = MARKING_DIMENSIONS.value.edgeLine.width[1];
/** 車線境界線 width (102: 0.10–0.15 m). */
export const XW_LANE_WIDTH = MARKING_DIMENSIONS.value.laneLine.width[1];
/** Past the end of a "same" stretch the pair stays one slab while the slabs still overlap (the nose). */
export const MERGE_PAD_M = 20;

/** One side of a ring as the other decks leave it. */
export type DeckSide = {
  /**
   * Another deck in the same direction is joined to this one on that side: "child" this deck is the
   * one cut at the other's edge (the ramp), "parent" the other is cut at this deck's edge.
   */
  joined: "child" | "parent" | null;
  /**
   * The other deck's nearest lane edge, metres left of this deck's centre, where joined; null
   * otherwise.
   */
  otherLaneEdge: number | null;
  /**
   * Where this deck's road surface ends on that side, metres from the centre towards it (below zero:
   * the other deck covers past the centre). Normally the 壁高欄's inner face.
   */
  reach: number;
  /** The 壁高欄 on that side (inner and outer face, metres from the centre), or none. */
  wall: { inner: number; outer: number } | null;
  /**
   * Where the road ends on the master deck's slab edge (local frame): the point of the master's
   * face there, so the two meet with no step. The master's face continues past it.
   */
  seam: { x: number; y: number; z: number } | null;
  /** Whose edge the seam lies on (run and which of its edges, left +1), for the rings it needs. */
  seamOf: { run: string; edge: 1 | -1 } | null;
};

export type RingSides = { left: DeckSide; right: DeckSide };

/** Which run ends on which (meta.json's run ends): the 分合流 between two runs. */
export function roleOf(
  runs: ReadonlyMap<string, XwRunSummary>,
  mine: string,
  other: string,
): "child" | "parent" | "peer" {
  const endsOn = (a: string, b: string) => {
    const r = runs.get(a);
    return r !== undefined && (r.start.parent === b || r.end.parent === b);
  };
  if (endsOn(mine, other)) return "child";
  if (endsOn(other, mine)) return "parent";
  return "peer";
}

/**
 * The loaded chunks by run, and which runs a chunk shares one surface with (its `decks`). Why not
 * the overlaps found again at run time (P3's NEIGHBOUR_DZ over every loaded deck, W7): the
 * compiler already decided the relation from the plan lines, the crossings and the OSM layers,
 * and format.ts promises the game reads it instead.
 */
export class DeckIndex {
  private readonly byRun = new Map<string, XwChunk[]>();
  private readonly added = new Set<string>();

  constructor(readonly runs: ReadonlyMap<string, XwRunSummary>) {}

  add(chunk: XwChunk): void {
    if (this.added.has(chunk.id)) return;
    this.added.add(chunk.id);
    const list = this.byRun.get(chunk.run) ?? [];
    list.push(chunk);
    list.sort((a, b) => a.k - b.k);
    this.byRun.set(chunk.run, list);
  }

  /** The loaded chunks of a run, in order. */
  chunksOf(run: string): readonly XwChunk[] {
    return this.byRun.get(run) ?? [];
  }

  /**
   * The runs `chunk` shares one surface with at s: the "same" stretches of it and of its loaded
   * neighbours in the run (the compiler cuts a stretch at the chunk's ends), padded by MERGE_PAD_M
   * (the slabs still overlap for a few metres after the carriageways part), but not where it stands
   * over or under that run (a padded end must not reach into a two-level stretch).
   */
  partnersAt(chunk: Pick<XwChunk, "run" | "k" | "decks">, s: number): string[] {
    const near = this.chunksOf(chunk.run).filter((c) => Math.abs(c.k - chunk.k) === 1);
    const decks = [...chunk.decks, ...near.flatMap((c) => c.decks)];
    const out: string[] = [];
    for (const d of decks) {
      const isSame = d.relation === "same";
      const isNear = s >= d.s0 - MERGE_PAD_M && s <= d.s1 + MERGE_PAD_M;
      if (!isSame || !isNear || out.includes(d.with)) continue;
      const isLevelApart = decks.some(
        (e) => e.with === d.with && e.relation !== "same" && s >= e.s0 && s <= e.s1,
      );
      if (!isLevelApart) out.push(d.with);
    }
    return out;
  }
}

export type XwMarkingKind = "edge" | "lane" | "branch";

/** A line along a deck: offsets metres left of the centre, `from` / `to` run distances. */
export type XwMarkingLine = {
  kind: XwMarkingKind;
  offset: number;
  from: number;
  to: number;
  colour: MarkingColour;
  width: number;
  dash: { length: number; gap: number } | null;
};

/** A 導流帯: its two borders (offsets) at each ring distance `s`. */
export type XwZebra = { s: number[]; inner: number[]; outer: number[] };

export type XwMarkingPlan = { lines: XwMarkingLine[]; zebras: XwZebra[] };

type SideState = { kind: "edge" | "branch" | "none" } | { kind: "zebra"; inner: number; outer: number };

/** Width of an edge line and of the 分合流部 line that replaces it. */
const widthOf = (kind: "edge" | "branch") => (kind === "edge" ? XW_EDGE_WIDTH : BRANCH_LINE.value.width);

/** Whether a line `width` wide at offset u lies on a ring's own road (between the two reaches). */
function isOnRoad(sides: RingSides, u: number, width: number): boolean {
  return u - width / 2 >= -sides.right.reach - 1e-6 && u + width / 2 <= sides.left.reach + 1e-6;
}

/** [from, to] windows of the rings where `on` holds, cut halfway between two rings that differ. */
function windowsOf(ss: readonly number[], on: readonly boolean[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let from: number | null = null;
  for (let i = 0; i < ss.length; i++) {
    const isEnd = i === ss.length - 1;
    const start = i === 0 ? ss[0] : (ss[i - 1] + ss[i]) / 2;
    if (on[i] && from === null) from = start;
    const isClosing = from !== null && (isEnd || !on[i + 1]);
    if (!isClosing) continue;
    const to = isEnd ? ss[i] : (ss[i] + ss[i + 1]) / 2;
    if (to - from! > 0.05) out.push([from!, to]);
    from = null;
  }
  return out;
}

/**
 * The markings of one chunk from its rings (distance s and sides). Lines are cut where a side's
 * state changes, halfway between the two rings, and wherever they would leave the deck's own road.
 */
export function planDeckMarkings(
  chunk: Pick<XwChunk, "lanes" | "laneWidth" | "shoulderL" | "shoulderR">,
  rings: ReadonlyArray<{ s: number; sides: RingSides }>,
): XwMarkingPlan {
  const half = sectionWidth(chunk) / 2;
  const lines: XwMarkingLine[] = [];
  const zebras: XwZebra[] = [];
  const ss = rings.map((r) => r.s);
  const edgeOf = (sign: 1 | -1) => sign * (half - (sign > 0 ? chunk.shoulderL : chunk.shoulderR));
  const stateAt = (side: DeckSide, sign: 1 | -1): SideState => {
    const own = edgeOf(sign);
    const other = side.otherLaneEdge;
    const isJoined = side.joined !== null && other !== null;
    if (!isJoined) return { kind: "edge" };
    const gap = sign * (other - own);
    const isApart = gap > ZEBRA_MIN_GAP;
    if (isApart) {
      // The strip runs to the master's lane edge over its face (the seam is level with it); with
      // no master face past the road's end it stops there.
      const outer = side.seam ? other : sign * Math.min(Math.abs(other), side.reach);
      return side.joined === "child" ? { kind: "zebra", inner: own, outer } : { kind: "edge" };
    }
    return side.joined === "parent" ? { kind: "branch" } : { kind: "none" };
  };
  // A ramp whose lane runs inside the main line's (its lanes meet on one side) paints nothing
  // there: the main line's lines are the ones on that surface, and two sets drawn a few
  // centimetres apart flickered and crossed (round 1 of the review, the 4853799 diverge).
  const isInsideParent = (r: { sides: RingSides }) =>
    ([1, -1] as const).some((sign) => {
      const side = sign > 0 ? r.sides.left : r.sides.right;
      return side.joined === "child" && stateAt(side, sign).kind === "none";
    });
  for (const sign of [1, -1] as const) {
    const states = rings.map((r): SideState => {
      if (isInsideParent(r)) return { kind: "none" };
      const st = stateAt(sign > 0 ? r.sides.left : r.sides.right, sign);
      const isLine = st.kind === "edge" || st.kind === "branch";
      const isOff = isLine && !isOnRoad(r.sides, edgeOf(sign), widthOf(st.kind as "edge" | "branch"));
      return isOff ? { kind: "none" } : st;
    });
    for (const kind of ["edge", "branch"] as const) {
      for (const [from, to] of windowsOf(
        ss,
        states.map((st) => st.kind === kind),
      ))
        lines.push({
          kind,
          offset: edgeOf(sign),
          from,
          to,
          colour: "white",
          width: widthOf(kind),
          dash: kind === "branch" ? { length: BRANCH_LINE.value.dash, gap: BRANCH_LINE.value.gap } : null,
        });
    }
    for (let i = 0; i < rings.length; i++) {
      const isZebraEnd =
        states[i].kind === "zebra" && (i === rings.length - 1 || states[i + 1].kind !== "zebra");
      if (!isZebraEnd) continue;
      const zebra: XwZebra = { s: [], inner: [], outer: [] };
      for (let j = i; j >= 0 && states[j].kind === "zebra"; j--) {
        const z = states[j] as Extract<SideState, { kind: "zebra" }>;
        zebra.s.unshift(rings[j].s);
        zebra.inner.unshift(z.inner);
        zebra.outer.unshift(z.outer);
      }
      const isLong = zebra.s.length >= 2;
      if (isLong) zebras.push(zebra);
    }
  }
  const dash = LANE_LINE_DASH.value;
  for (let k = 1; k < chunk.lanes; k++) {
    // laneLeftEdge − k·laneWidth (laneChange.ts counts lanes from the left edge of the lanes).
    const offset = edgeOf(1) - k * chunk.laneWidth;
    const on = rings.map((r) => isOnRoad(r.sides, offset, XW_LANE_WIDTH));
    for (const [from, to] of windowsOf(ss, on))
      lines.push({
        kind: "lane",
        offset,
        from,
        to,
        colour: "white",
        width: XW_LANE_WIDTH,
        dash: { length: dash.dash, gap: dash.gap },
      });
  }
  return { lines, zebras };
}

/** The stripes of a 導流帯 as quads [s, offset] × 4, ZEBRA.pitch apart along the strip. */
export function zebraStripes(zebra: XwZebra): Array<Array<[number, number]>> {
  const { stripe, pitch } = ZEBRA.value;
  const at = (arr: number[], s: number) => {
    let i = 0;
    while (i < zebra.s.length - 2 && zebra.s[i + 1] < s) i++;
    const t = Math.min(1, Math.max(0, (s - zebra.s[i]) / (zebra.s[i + 1] - zebra.s[i] || 1)));
    return arr[i] + (arr[i + 1] - arr[i]) * t;
  };
  const s0 = zebra.s[0];
  const s1 = zebra.s[zebra.s.length - 1];
  const out: Array<Array<[number, number]>> = [];
  // Phase from the run distance, so a strip cut by a chunk seam keeps its stripes in step.
  for (let s = Math.ceil(s0 / pitch) * pitch; s <= s1; s += pitch) {
    const a = at(zebra.inner, s);
    const b = at(zebra.outer, s);
    const reach = Math.abs(b - a);
    const isTooThin = reach < 0.2;
    if (isTooThin) continue;
    // 45° across the strip, towards travel.
    const e = Math.min(s1, s + reach);
    const b1 = at(zebra.outer, e);
    out.push([
      [s, a],
      [s + stripe, a],
      [Math.min(s1, e + stripe), b1],
      [e, b1],
    ]);
  }
  return out;
}

/** The dashes of a dashed line inside [from, to], phased from the run distance (seams keep step). */
export function dashWindows(line: Pick<XwMarkingLine, "from" | "to" | "dash">): Array<[number, number]> {
  if (!line.dash) return [[line.from, line.to]];
  const period = line.dash.length + line.dash.gap;
  const out: Array<[number, number]> = [];
  for (let start = Math.floor(line.from / period) * period; start < line.to; start += period) {
    const a = Math.max(line.from, start);
    const b = Math.min(line.to, start + line.dash.length);
    if (b - a > 0.05) out.push([a, b]);
  }
  return out;
}
