import type { RoadLine, Segment } from "./roads";

/**
 * The cross-section of a road and the lanes in it, in one place. Everything that asks where a lane
 * is goes through here: the painted lines (roadSurface.ts via roadMarkings.ts), the 進路変更禁止
 * check in main.ts, the route's lane plan (drivePath.ts, the green arrows), the autopilot, the
 * navi's lane advice, the guide boards and the traffic AI. A second copy of the arithmetic would
 * let the arrows cross a line the checker books (knowledge/turn-paths.md).
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
 * The width the lanes are laid out in. Today the GSI 幅員 as it comes, though it may include the
 * pavement; the insets that cope with that in the lane arithmetic are in KERB_INSET below. P8
 * corrects the width here (lanes × width + shoulders, capped by 幅員), but that is not one change:
 * about 117 places in src still read `line.width` directly (signs, sidewalks, junction boxes,
 * collisions …) and each has to move to this function first (knowledge/road-model.md).
 */
export function carriagewayWidth(line: RoadLine): number {
  return line.width;
}

/**
 * How far in from the GSI edge each user stays, because 幅員 may include the pavement. They differ
 * because each was tuned on its own; P8 replaces them with the section's shoulders. Why not unify
 * them now: each change moves the cars, the arrows or the paint (P2 changes no output).
 */
export const KERB_INSET = {
  /** A car keeping left on a street without lanes (laneOffset). */
  keepLeft: 2,
  /** A lane centre for the autopilot and the route (drivePath laneCentre). */
  laneCentre: 1.6,
  /** …and on a two-way street, from the centre line. */
  centreLine: 0.8,
  /** 車道外側線 and the stop line's end (roadMarkings.ts). */
  edgeLine: 0.4,
} as const;

/** Lane width the width estimate assumes (構造令 第5条第4項 第四種第一級 3.25 m). */
const ESTIMATE_LANE = 3.25;
/** A JARTIC count that needs more than this a lane for one direction is the total for both. */
const JARTIC_LANE_TEST = 3;
/** Never narrower than this a lane, whatever JARTIC says (GSI widths are coarse). */
const NARROWEST_LANE = 2.75;

/** Evidence for a direction's lane count, strongest first (JARTIC ＞ OSM ＞ width). */
export type LaneEvidence = {
  /** JARTIC 車両通行帯 count for the section (0: listed with the count blank); null: not listed. */
  jartic?: number | null;
  /** Lanes the regulation pass already fixed for the segment (Segment.lanes, from JARTIC). */
  resolved?: number;
  /** OSM `lanes` for the direction. Not fed until P8 (the turnlanes tiles have no column yet). */
  osm?: number | null;
};

/**
 * Lanes when nothing is listed: the painted lanes are 1 (no 車線境界線 without a listed section),
 * the guide boards assume the width's worth. Two policies, kept as they are until P8 merges them.
 */
export type UnlistedLanes = "painted" | "byWidth";

/**
 * The cross-section of one direction of a carriageway `width` wide. The one place that decides a
 * lane count: JARTIC 車両通行帯 (per direction; a count too big for one direction is both), then
 * OSM, then the width. GSI streets have no shoulders or median in the data, so those are 0.
 */
export function resolveSection(
  width: number,
  isOneWay: boolean,
  evidence: LaneEvidence = {},
  unlisted: UnlistedLanes = "painted",
): CrossSection {
  const span = isOneWay ? width : width / 2;
  const byWidth = Math.round(span / ESTIMATE_LANE);
  const section = (lanes: number, basis: SectionBasis): CrossSection => ({
    lanes,
    laneWidth: span / Math.max(1, lanes),
    shoulderL: 0,
    shoulderR: 0,
    median: 0,
    basis,
  });
  const count = evidence.jartic;
  const isListed = count !== null && count !== undefined;
  if (isListed) {
    // Listed with the count blank: assume what the width takes, 2 to 4.
    const isCountBlank = !count;
    if (isCountBlank) return section(Math.min(4, Math.max(2, byWidth)), "width");
    const isBothWays = !isOneWay && count * JARTIC_LANE_TEST > span + 1;
    const perDirection = isBothWays ? Math.ceil(count / 2) : count;
    return section(Math.max(1, Math.min(perDirection, Math.floor(span / NARROWEST_LANE))), "jartic");
  }
  const isAlreadyResolved = (evidence.resolved ?? 1) > 1;
  if (isAlreadyResolved) return section(evidence.resolved ?? 1, "jartic");
  const osm = evidence.osm ?? 0;
  const hasOsmLanes = osm > 0;
  if (hasOsmLanes) return section(osm, "osm");
  const isPainted = unlisted === "painted";
  return section(isPainted ? 1 : Math.max(1, byWidth), "width");
}

/**
 * The section a segment is painted and driven with, split into `n` lanes (default its own). A line
 * with its own section (the expressway, P3) is taken as it is when asked for its own lane count;
 * otherwise the direction's width less shoulders and half the median is split evenly.
 *
 * `basis` of a GSI street is inferred, not recorded: more than one lane can only have come from
 * JARTIC's 車両通行帯 (lanesPerDirection), though a blank JARTIC count was filled from the width
 * ("width" in resolveSection). Why not record it on the segment: a new key would change the
 * worker's reply, which P2 keeps byte for byte; P8 records it with the OSM lanes.
 */
export function sectionOf(seg: Segment, n = seg.lanes): CrossSection {
  const width = carriagewayWidth(seg.line);
  const lanes = Math.max(1, n);
  const given = seg.line.section;
  const isGivenAsIs = given !== undefined && given.lanes === lanes;
  if (isGivenAsIs) return given;
  const shoulderL = given?.shoulderL ?? 0;
  const shoulderR = given?.shoulderR ?? 0;
  const median = given?.median ?? 0;
  const span = seg.oneway === 0 ? width / 2 - shoulderL - median / 2 : width - shoulderL - shoulderR;
  return {
    lanes,
    laneWidth: span / lanes,
    shoulderL,
    shoulderR,
    median,
    basis: given?.basis ?? (seg.lanes > 1 ? "jartic" : "width"),
  };
}

/** Left edge of the lanes (metres left of the centreline): the carriageway edge less the shoulder. */
export function laneLeftEdge(seg: Segment): number {
  return carriagewayWidth(seg.line) / 2 - (seg.line.section?.shoulderL ?? 0);
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
 * Centre of lane `lane` of `n` (0 = by the left kerb), metres left of the centreline, from the
 * section alone: no inset from the kerb (laneCentre in drivePath.ts adds those).
 */
export function laneCentreOffset(seg: Segment, lane: number, n = seg.lanes): number {
  return laneLeftEdge(seg) - (lane + 0.5) * laneWidth(seg, n);
}

/**
 * Lane (0 = by the left kerb) of a point `leftOfTravel` metres left of the centreline, counted
 * the way the lines are painted. Not clamped: below 0 is beyond the left edge, ≥ n across the
 * centre line (or the right edge of a one-way street).
 */
export function laneOfOffset(seg: Segment, leftOfTravel: number, n = seg.lanes): number {
  return Math.floor((laneLeftEdge(seg) - leftOfTravel) / laneWidth(seg, n));
}

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
 * this direction's carriageway (on the pavement, across the centre line).
 */
export function laneOfPoint(seg: Segment, leftOfTravel: number): number | null {
  const lane = laneOfOffset(seg, leftOfTravel);
  return lane >= 0 && lane < seg.lanes ? lane : null;
}
