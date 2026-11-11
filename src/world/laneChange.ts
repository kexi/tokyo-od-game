import { LANE_WIDTH, PAVEMENT_WIDTH, SHOULDER } from "../law/roadStandards";
import {
  JARTIC_BLANK_MOST,
  JARTIC_TOTAL_TEST,
  MEDIAN_MOST,
  NARROWEST_LANE,
  PAVED_FROM,
} from "./streetAssumptions";
import type { RoadLine, Segment } from "./roads";

/**
 * The cross-section of a road and the lanes in it, in one place. Everything that asks where a lane
 * is goes through here: the painted lines (roadSurface.ts via roadMarkings.ts), the 進路変更禁止
 * check in main.ts, the route's lane plan (drivePath.ts, the green arrows), the autopilot, the
 * navi's lane advice, the guide boards, the orbis gantries and the traffic AI. A second copy of the
 * arithmetic would let the arrows cross a line the checker books (knowledge/turn-paths.md).
 *
 * 進路変更禁止 (道路交通法 第26条の2第3項): where a 車両通行帯 is bounded by the yellow lane line
 * (標示 102 の 2, JARTIC 52・119 → Segment.noLaneChange), a car keeps the lane it is in.
 */

/** What a section rests on (QA and tests read it); "statute" / "assumption" as src/expressway/section.ts. */
export type SectionBasis = "jartic" | "osm" | "width" | "statute" | "assumption";

/**
 * One direction's carriageway across, constant along a section (a change starts a new section).
 * Offsets are metres; `laneWidth` splits what is left of the direction's half (two-way) or of the
 * whole carriageway (one-way) once the shoulders and half the median are taken off.
 */
export type CrossSection = {
  lanes: number;
  laneWidth: number;
  shoulderL: number;
  shoulderR: number;
  median: number;
  basis: SectionBasis;
  /** 変速車線 (P3): a taper on one side from `widthStart` to `widthEnd`. */
  aux?: { side: "left" | "right"; kind: "accel" | "decel"; widthStart: number; widthEnd: number };
};

/**
 * 道路構造令 values a street is laid out with: 第四種 (都市部の一般道, 第3条) 第一級 lanes of
 * 3.25 m (第5条第4項) and 0.5 m shoulders both sides (第8条第2項・第4項). Why 第一級 for every street
 * and not 第二級・第三級 (3.0 m): the class follows the planned traffic, which no data gives; the
 * streets with lanes to lay out are the arterials, and the wider lane errs towards the old look.
 */
export const STREET = {
  laneWidth: LANE_WIDTH.value.type4class1,
  shoulder: SHOULDER.value.type4Left,
} as const;

/** Each pavement taken off a wide 幅員 (assumptions.PAVED_FROM): 第11条第3項, busy pedestrian traffic. */
const PAVEMENT = PAVEMENT_WIDTH.value.busy;

/** Which way a street runs for its section: 0 both ways, 1 along the coords, −1 against (true ≡ 1). */
export type SectionTravel = 0 | 1 | -1 | boolean;
const travelOf = (t: SectionTravel): 0 | 1 | -1 => (t === true ? 1 : t === false ? 0 : t);

/** Evidence for a street's lanes, strongest first (JARTIC ＞ OSM ＞ width). */
export type LaneEvidence = {
  /** JARTIC 車両通行帯 count for the section (0: listed with the count blank); null: not listed. */
  jartic?: number | null;
  /** OSM lanes along and against the coords (0 where not mapped), matched onto the segment. */
  osm?: { forward: number; backward: number } | null;
  /** OSM `width` (m) of the carriageway, where mapped. */
  osmWidth?: number | null;
  /**
   * How far apart (m) the two one-way ways of a divided road run, where OSM maps it so: each way is
   * drawn down the middle of its carriageway, so the gap less one carriageway is the 中央帯.
   */
  osmSeparation?: number | null;
  /**
   * A count fixed elsewhere (a Segment whose lanes were set directly, as tests do): basis
   * "assumption", since nothing says where it came from.
   */
  lanes?: number;
  /** A 中央帯 already resolved (a recorded section whose lane count was set afterwards). */
  median?: number;
};

/**
 * Both directions of a street: the cross-section of one direction (`lanes` is what each direction
 * is painted and judged with), the counts by direction as the evidence gave them, and the 車道
 * width the lanes sit in, centred on the centreline. What is left of the GSI 幅員 outside the
 * carriageway is pavement or 路側帯 (drawn as asphalt; PLATEAU's pavements cover it where mapped).
 */
export type StreetSection = CrossSection & {
  /** Lanes along the coords and against them (one-way: the other is 0), before the even split. */
  forward: number;
  backward: number;
  /** 車道 width: lanes, shoulders and median, never wider than the room the 幅員 leaves. */
  carriageway: number;
};

/**
 * The room a street's carriageway has, and how many lanes a direction can hold in it at the
 * narrowest lane: OSM's width where mapped, else the GSI 幅員 less a pavement on each side when it
 * is wide (assumptions PAVED_FROM). The one room every count is checked against: JARTIC's count,
 * whether that count is a total, OSM's lanes (and the matcher's fit test), the carriageway's cap.
 */
export function streetRoom(
  width: number,
  travel: SectionTravel,
  osmWidth: number | null = null,
): { room: number; fitting: number } {
  const isOneWay = travelOf(travel) !== 0;
  const hasOsmWidth = (osmWidth ?? 0) > 0;
  const isPaved = !hasOsmWidth && width >= PAVED_FROM.value;
  const room = hasOsmWidth ? Math.min(width, osmWidth ?? width) : isPaved ? width - 2 * PAVEMENT : width;
  const span = isOneWay ? room - 2 * STREET.shoulder : room / 2 - STREET.shoulder;
  return { room, fitting: Math.max(1, Math.floor(span / NARROWEST_LANE.value)) };
}

/**
 * The one place that decides a street's lanes and its carriageway, from the GSI 幅員 `width`: JARTIC
 * 車両通行帯 (per direction, or both directions' total when it cannot be one direction's), then OSM
 * `lanes`, then one lane: more than one lane is drawn and judged only where JARTIC or OSM says so.
 * Why not estimate lanes from the width (P8 at first): GSI widths are class values that may include
 * the pavement, and the estimate was not even monotonic on one-way streets (review W1). The
 * carriageway is the lanes, shoulders and median, capped by the room (streetRoom): so the lanes
 * keep 3.25 m on a street whose 幅員 includes the pavement, and squeeze on a narrow one.
 *
 * Lanes are the same both ways (`lanes`, the larger of the two): the paint, the lane checks and
 * the route plan share one count per segment. Why not paint each direction its own count: every
 * user of Segment.lanes (main.ts's checks, drivePath, the autopilot) would have to say which way
 * it travels (P6). `forward` / `backward` keep what the evidence said, along the coords.
 */
export function resolveSection(
  width: number,
  travel: SectionTravel,
  evidence: LaneEvidence = {},
): StreetSection {
  const dir = travelOf(travel);
  const isOneWay = dir !== 0;
  const dirs = isOneWay ? 1 : 2;
  const { room, fitting } = streetRoom(width, dir, evidence.osmWidth ?? null);
  const roomForLanes = isOneWay ? room - 2 * STREET.shoulder : room / 2 - STREET.shoulder;
  const build = (forward: number, backward: number, basis: SectionBasis, space = room): StreetSection => {
    const lanes = Math.max(1, forward, backward);
    const roadway = dirs * lanes * STREET.laneWidth + 2 * STREET.shoulder;
    // The 中央帯 a divided road's OSM ways imply: the gap less one direction's shoulder and lanes
    // (第6条: with a median the right shoulder gives way to it), within what the room leaves.
    const separation = isOneWay ? 0 : (evidence.osmSeparation ?? 0);
    const impliedMedian = Math.min(
      MEDIAN_MOST.value,
      separation - STREET.shoulder - lanes * STREET.laneWidth,
    );
    const median = isOneWay ? 0 : Math.max(0, Math.min(evidence.median ?? impliedMedian, space - roadway));
    const carriageway = Math.min(space, roadway + median);
    // A direction's lanes sit between its shoulder and the centre line or the median (two-way), or
    // between the two shoulders (one-way), as sectionOf splits them.
    const lanesSpan = isOneWay
      ? carriageway - 2 * STREET.shoulder
      : carriageway / 2 - STREET.shoulder - median / 2;
    return {
      lanes,
      laneWidth: lanesSpan / lanes,
      shoulderL: STREET.shoulder,
      shoulderR: STREET.shoulder,
      median,
      basis,
      forward,
      backward,
      carriageway,
    };
  };
  // One count both ways; a one-way street's lanes lie in its direction of travel.
  const both = (n: number, basis: SectionBasis, space = room) =>
    build(dir === -1 ? 0 : n, dir === 1 ? 0 : n, basis, space);
  // One direction mapped only (one carriageway of a divided road matched): the other taken alike.
  const osmAlong = evidence.osm?.forward || evidence.osm?.backward || 0;
  const osmAgainst = evidence.osm?.backward || evidence.osm?.forward || 0;
  const count = evidence.jartic;
  const isListed = count !== null && count !== undefined;
  if (isListed) {
    // Listed with the count blank: at least 2, what the room takes up to JARTIC_BLANK_MOST.
    const isCountBlank = !count;
    const byRoom = Math.floor(roomForLanes / STREET.laneWidth);
    const blank = Math.min(fitting, JARTIC_BLANK_MOST.value, Math.max(2, byRoom));
    if (isCountBlank) return both(blank, "width");
    // Whether the count is both directions' total: too many for one direction's room at 3 m a lane,
    // or nearer OSM's total than OSM's count a direction (丸の内's 日比谷通り: 5 is 3 + 2, not 5 a way).
    const isNearerOsmTotal =
      osmAlong > 0 &&
      Math.abs(count - (osmAlong + osmAgainst)) <= Math.abs(count - Math.max(osmAlong, osmAgainst));
    const isTooManyForOne = count * JARTIC_TOTAL_TEST.value > roomForLanes + STREET.shoulder + 1;
    const isBothWays = !isOneWay && (isTooManyForOne || isNearerOsmTotal);
    const perDirection = isBothWays ? Math.ceil(count / 2) : count;
    return both(Math.max(1, Math.min(perDirection, fitting)), "jartic");
  }
  if (osmAlong > 0) {
    if (isOneWay) return both(Math.min(Math.max(osmAlong, osmAgainst), fitting), "osm");
    return build(Math.min(osmAlong, fitting), Math.min(osmAgainst, fitting), "osm");
  }
  const fixed = evidence.lanes ?? 0;
  const isFixed = fixed > 0;
  // A count set by hand says the lanes are there: laid out in the whole 幅員, with no pavement
  // taken off (the pavement is the guess that gives way to a stated count).
  if (isFixed) return both(fixed, "assumption", width);
  return both(1, "width");
}

/**
 * The section of a segment: the one recorded when the graph was built or the regulations applied
 * (Segment.section); where its lane count was set afterwards (tests, a hand-written segment), the
 * same street with that count, keeping the recorded 中央帯 and OSM width.
 */
export function streetSection(seg: Segment): StreetSection {
  const recorded = seg.section;
  const isRecorded = recorded !== undefined && recorded.lanes === seg.lanes;
  if (isRecorded) return recorded;
  return resolveSection(seg.line.width, seg.oneway, { lanes: seg.lanes, median: recorded?.median });
}

/**
 * 車道 width: what the lanes, the edge lines, the stop lines and the cars' lateral positions are
 * measured in, centred on the centreline. A line with its own section (the expressway) is that
 * section's width; a GSI street is its resolved section's (capped by the 幅員, which may include the
 * pavement). Readers of the physical road edge (kerb, posts, pavements, the asphalt) keep reading
 * `line.width`, the GSI 幅員 (knowledge/road-model.md classifies them).
 */
export function carriagewayWidth(of: Segment | RoadLine): number {
  const isSegment = "line" in of;
  const line = isSegment ? of.line : of;
  const given = line.section;
  if (given) {
    const dirs = line.oneway === 0 ? 2 : 1;
    return dirs * given.lanes * given.laneWidth + given.shoulderL + given.shoulderR + given.median;
  }
  if (isSegment) return streetSection(of).carriageway;
  return resolveSection(line.width, line.oneway).carriageway;
}

/**
 * The section a segment is painted and driven with, split into `n` lanes (default its own). A line
 * with its own section (the expressway, P3) is taken as it is when asked for its own lane count;
 * otherwise the direction's carriageway less shoulders and half the median is split evenly.
 */
export function sectionOf(seg: Segment, n = seg.lanes): CrossSection {
  const lanes = Math.max(1, n);
  const given = seg.line.section;
  const isGivenAsIs = given !== undefined && given.lanes === lanes;
  if (isGivenAsIs) return given;
  const base: CrossSection = given ?? streetSection(seg);
  const width = carriagewayWidth(seg);
  const span =
    seg.oneway === 0 ? width / 2 - base.shoulderL - base.median / 2 : width - base.shoulderL - base.shoulderR;
  return {
    lanes,
    laneWidth: span / lanes,
    shoulderL: base.shoulderL,
    shoulderR: base.shoulderR,
    median: base.median,
    basis: base.basis,
  };
}

/** Left shoulder (第8条): the 車道外側線 runs this far inside the carriageway's edge. */
export function shoulderOf(seg: Segment): number {
  return seg.line.section?.shoulderL ?? streetSection(seg).shoulderL;
}

/** Left edge of the lanes (metres left of the centreline): the carriageway edge less the shoulder. */
export function laneLeftEdge(seg: Segment): number {
  return carriagewayWidth(seg) / 2 - shoulderOf(seg);
}

/** Whether changing lanes on this segment is 進路変更禁止違反 (yellow lane lines between lanes). */
export function isLaneChangeBanned(seg: Segment): boolean {
  return seg.noLaneChange && seg.lanes >= 2;
}

/** Width of one lane of `n` in the direction of travel (the painted 車線境界線 split it evenly). */
export function laneWidth(seg: Segment, n = seg.lanes): number {
  return sectionOf(seg, n).laneWidth;
}

/**
 * Centre of lane `lane` of `n` (0 = by the left edge line), metres left of the centreline. The
 * shoulder is outside the lanes, so the centre needs no further inset from the kerb.
 */
export function laneCentreOffset(seg: Segment, lane: number, n = seg.lanes): number {
  return laneLeftEdge(seg) - (lane + 0.5) * laneWidth(seg, n);
}

/**
 * Lane (0 = by the left kerb) of a point `leftOfTravel` metres left of the centreline, counted
 * the way the lines are painted. Not clamped: below 0 is beyond the left edge line (on the
 * shoulder or the pavement), ≥ n across the centre line (or the right edge of a one-way street).
 */
export function laneOfOffset(seg: Segment, leftOfTravel: number, n = seg.lanes): number {
  // A point on a painted line counts in the lane right of it (on the centre line: across it). Why
  // the margin: the lines sit on exact multiples of the lane width, and a car placed on the
  // centreline (a start point) or a curve's interpolated offset lands on one; the last bit of a
  // double then picked the side, and one ulp of input moved the autopilot's whole drive.
  return Math.floor((laneLeftEdge(seg) - leftOfTravel) / laneWidth(seg, n) + ON_LINE);
}

/** How far past a painted line, in lane widths, a point on it is counted (laneOfOffset). */
const ON_LINE = 1e-9;

/**
 * The offsets (metres left of the centreline) a path in `lane` may take on this segment, kept
 * `margin` inside its painted lines so that rounding never puts it over one.
 */
export function laneBand(
  seg: Segment,
  lane: number,
  n = seg.lanes,
  margin = 0.5,
): { min: number; max: number } {
  const w = laneWidth(seg, n);
  const inset = Math.min(margin, w / 4);
  const left = laneLeftEdge(seg) - lane * w;
  return { min: left - w + inset, max: left - inset };
}

/**
 * The lane a car is in, `leftOfTravel` metres left of the centreline, or null when it is not on
 * this direction's carriageway (on the shoulder or pavement, across the centre line).
 */
export function laneOfPoint(seg: Segment, leftOfTravel: number): number | null {
  const lane = laneOfOffset(seg, leftOfTravel);
  return lane >= 0 && lane < seg.lanes ? lane : null;
}
