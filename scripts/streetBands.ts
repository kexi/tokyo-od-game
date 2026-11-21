// R1-2a's rules for a street segment with an expressway's site beside or under it (memo 改訂 1, 3.2
// and 3.3), kept apart from the files and tiles scripts/measureStreetBands.ts reads so that they can
// be tested: how a segment's samples become bands, and what class and section the bands give.
// Offsets are metres left of the centre line along the coords.
import { STREET } from "../src/world/laneChange.ts";
import { NARROWEST_LANE } from "../src/world/streetAssumptions.ts";

const SHOULDER = STREET.shoulder;
const LANE_MIN = NARROWEST_LANE.value;
/** The street lane width a widened carriageway is laid out with. */
const LANE_LAID = STREET.laneWidth;

/** A band across a street: no lane's centre may lie between `right` and `left`. */
export type Band = { right: number; left: number };
export type Klass = "clear" | "A" | "A'" | "B1" | "B2" | "B3" | "C";
/** A class and, for A / A', the section it gives (carriageway centred, median, lanes a way). */
export type Ruling = { klass: Klass; lanesAfter: number; median: number; carriageway: number };

/** Lanes of NARROWEST_LANE a span holds (whole lanes). */
export const holds = (span: number) => Math.max(0, Math.floor(span / LANE_MIN + 1e-9));

/**
 * The samples' strips across a segment as bands: overlapping strips are one, and strips apart by less
 * than a lane (NARROWEST_LANE) are one; apart by a lane or more, each is its own band. Why not all in
 * one (left the largest, right the least, as R1-2-0 first did): two embankments either side of a
 * street (central's segment 1176, 15.7 m apart, a lane each way between) made a band over the whole
 * street, counted as fitting nowhere.
 */
export function mergeBands(strips: readonly Band[]): Band[] {
  const sorted = strips.toSorted((a, b) => a.right - b.right);
  const out: Band[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    const isTooClose = last !== undefined && s.right - last.left < LANE_MIN;
    if (isTooClose) {
      last.left = Math.max(last.left, s.left);
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

/**
 * What the room holds beside a band (memo B1 / B2): the most lanes (up to `lanes`) a one-way street
 * puts to one side of it, or a two-way one puts a way, one way each side or both to one side. A
 * lane or more is what B1 / B2 ask for (classify: offCentre ≥ 1), not all of them.
 */
export function offCentreLanes(room: number, travel: 0 | 1 | -1, lanes: number, band: Band): number {
  const a = Math.max(0, room / 2 - Math.max(band.left, -room / 2));
  const b = Math.max(0, Math.min(band.right, room / 2) + room / 2);
  const isOneWay = travel !== 0;
  if (isOneWay) return Math.min(lanes, Math.max(holds(a - 2 * SHOULDER), holds(b - 2 * SHOULDER)));
  const split = Math.min(holds(a - SHOULDER), holds(b - SHOULDER));
  const oneSide = Math.max(holds((a - 2 * SHOULDER) / 2), holds((b - 2 * SHOULDER) / 2));
  return Math.min(lanes, Math.max(split, oneSide));
}

/** The section a segment has now, its lanes' centres (both ways) and the room streetRoom leaves. */
export type SectionNow = {
  travel: 0 | 1 | -1;
  lanes: number;
  carriageway: number;
  median: number;
  room: number;
  centres: readonly number[];
};

/**
 * The class of a segment with bands (memo 3.3): the band over the centre line (if any) gives a
 * 中央帯, the nearest inner edge of the others caps the carriageway, both when both are there.
 * `offCentre` is what the room holds to one side of all the bands together (offCentreLanes). A
 * section that fits but keeps fewer lanes a way, both using the whole room, than `offCentre` is not
 * given (B3, memo 3.3 の 5): left to R1-2b's moved line. Why not give it anyway: a symmetric section
 * narrows the side with no site as much as the other (central's 1563: 4 → 1 lanes, lane 0 jumping
 * 12.5 m, where a moved line keeps 3), and R1-2a would narrow first what R1-2b undoes.
 */
export function classify(now: SectionNow, bands: readonly Band[], offCentre: number): Ruling {
  const ruling = classifySymmetric(now, bands, offCentre);
  const isResolved = ruling.klass === "A" || ruling.klass === "A'";
  if (!isResolved) return ruling;
  const isFewerThanMoved = offCentre > symmetricInRoom(now, bands, ruling);
  if (!isFewerThanMoved) return ruling;
  return { klass: "B3", lanesAfter: now.lanes, median: now.median, carriageway: now.carriageway };
}

/** The lanes a way the given symmetric section's rule holds when it may use the whole room. */
function symmetricInRoom(now: SectionNow, bands: readonly Band[], ruling: Ruling): number {
  const middle = bands.find((b) => b.right < 0 && b.left > 0);
  const sides = bands.filter((b) => b !== middle);
  const cap = 2 * Math.min(Infinity, ...sides.map((b) => Math.min(Math.abs(b.right), Math.abs(b.left))));
  const space = Math.min(now.room, cap);
  const isMedian = ruling.klass === "A";
  if (isMedian) {
    // A median over the middle band within the side cap, or (no middle band) over the side bands.
    const limit = middle ? space : now.room;
    return Math.min(now.lanes, holds(limit / 2 - SHOULDER - ruling.median / 2));
  }
  const span = now.travel === 0 ? space / 2 - SHOULDER : space - 2 * SHOULDER;
  return Math.min(now.lanes, holds(span));
}

function classifySymmetric(now: SectionNow, bands: readonly Band[], offCentre: number): Ruling {
  const { travel, lanes, carriageway, median, room, centres } = now;
  const isHit = centres.some((c) => bands.some((b) => c > b.right && c < b.left));
  if (!isHit) return { klass: "clear", lanesAfter: lanes, median, carriageway };
  const middle = bands.find((b) => b.right < 0 && b.left > 0);
  const sides = bands.filter((b) => b !== middle);
  const sideInner = Math.min(Infinity, ...sides.map((b) => Math.min(Math.abs(b.right), Math.abs(b.left))));
  const cap = 2 * sideInner;
  const unresolved = (): Ruling => ({
    klass: offCentre >= 1 ? (travel === 0 ? "B2" : "B1") : "C",
    lanesAfter: lanes,
    median,
    carriageway,
  });
  const isOneWay = travel !== 0;
  const hasMiddle = middle !== undefined;
  if (isOneWay) {
    if (hasMiddle) return unresolved();
    const capped = Math.min(carriageway, cap);
    const n = Math.min(lanes, holds(capped - 2 * SHOULDER));
    const holdsNoLane = n < 1;
    if (holdsNoLane) return unresolved();
    return { klass: "A'", lanesAfter: n, median: 0, carriageway: capped };
  }
  // The 中央帯 over a band reaching `outer` either side: the carriageway as it is first (its outer
  // edge kept), the room only when not a lane a way fits in it. Why not MEDIAN_MOST: a median capped
  // at 8 m does not cover the site.
  const byMedian = (outer: number, limit: number): Ruling | null => {
    const m = Math.max(median, 2 * outer);
    const kept = Math.min(carriageway, limit);
    const inKept = Math.min(lanes, holds(kept / 2 - SHOULDER - m / 2));
    const fitsAsItIs = inKept >= 1;
    if (fitsAsItIs) return { klass: "A", lanesAfter: inKept, median: m, carriageway: kept };
    const most = Math.min(room, limit);
    const widened = Math.min(lanes, holds(most / 2 - SHOULDER - m / 2));
    const fitsNowhere = widened < 1;
    if (fitsNowhere) return null;
    const cw = Math.max(kept, Math.min(most, 2 * widened * LANE_LAID + 2 * SHOULDER + m));
    return {
      klass: "A",
      lanesAfter: Math.min(lanes, holds(cw / 2 - SHOULDER - m / 2)),
      median: m,
      carriageway: cw,
    };
  };
  const outerOf = (b: Band) => Math.max(Math.abs(b.right), Math.abs(b.left));
  if (hasMiddle) return byMedian(outerOf(middle), cap) ?? unresolved();
  const capped = Math.min(carriageway, cap);
  const byRoom = Math.min(lanes, holds(capped / 2 - SHOULDER));
  const fitsCapped = byRoom >= 1;
  if (fitsCapped) return { klass: "A'", lanesAfter: byRoom, median: 0, carriageway: capped };
  return byMedian(Math.max(...sides.map(outerOf)), Infinity) ?? unresolved();
}

/** Lane 0's centre (left of travel) in a section: a way's span split evenly, as sectionOf does. */
export function laneZero(travel: 0 | 1 | -1, lanes: number, carriageway: number, median: number): number {
  const span = travel === 0 ? carriageway / 2 - SHOULDER - median / 2 : carriageway - 2 * SHOULDER;
  return carriageway / 2 - SHOULDER - 0.5 * (span / lanes);
}
