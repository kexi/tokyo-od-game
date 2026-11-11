import {
  type DeckLevel,
  type DeckLevels,
  type DeckStrip,
  deckGrade,
  deckHeight,
  stripCentre,
} from "../world/deckLevels";
import { PARAPET_WIDTH } from "./assumptions";
import type { Plane } from "./geo";
import type { XwSection } from "./section";

/**
 * Structure overrides (knowledge/road-redesign-plan.md 4.6 structureOverrides): a bridge whose
 * structure is a landmark model drawn without its roads (レインボーブリッジ) publishes the floors it
 * carries as `deckLevels` (src/world/deckLevels.ts). The compiler then builds those floors itself:
 *
 * - **plan**: the chain's samples over the suspended girder (`girderRange`) are pinned onto the
 *   deck's line (the axis + the carriageway band's centre offset), so the drawn deck stands where the
 *   model's floor beams are, not where OSM put its centre line (OSM sits 0.68 m south-west on
 *   average); on the anchorages beyond, the line eases back to OSM's (the upper floor turns there);
 * - **profile**: over `sRange` (girder and anchorages) the knots are pinned to the profile formula,
 *   so the deck follows the parabola (the formula, not the stations: between ~23 m stations a
 *   straight line kinks the grade by 0.1 %);
 * - **section**: lanes, shoulders and the 壁高欄 from the level's strips (`deckSection`) over the
 *   girder, with a render-only slab (`aprons`) over what a car may not use (the guideway, the
 *   walkways);
 * - **no piers or girder** inside `pierFreeRange` (the spans and the anchorages carry the decks).
 *
 * The OSM centre line must lie within `tolerance.horizontal` (3 m) of "axis + the strip's centre"
 * over the girder, or the build fails (`assertOsmMatches`): the bridge model and the road would
 * otherwise disagree by more than a lane and someone must look. The recorded OSM bias is counted
 * within those 3 m (`osmBias.decision: recorded`), not subtracted (the rule of rainbowBridge.test.ts,
 * which also checks the girder). Pure (no three.js), like the rest of src/expressway.
 */

/** A landmark whose deckLevels the compiler builds, and the street ways it carries (the lower floor). */
export type StructureSpec = {
  /** landmarks.json id of the structure-only model. */
  landmark: string;
  /**
   * OSM ways compiled as `street` decks (一般道の断面): the lower floor's road and its approaches from
   * the ground to the ground. Named here because GSI drops them (lvOrder ≠ 0) and the generic "every
   * street on a viaduct" is out of scope (設計書 4.6). Each list is one direction, ground to ground.
   */
  streets: Record<string, readonly number[]>;
};

/**
 * レインボーブリッジ's lower floor (臨港道路), both directions ground to ground (OSM ODbL, read
 * 2026-11-11 from the Geofabrik extract of 2026-10-03): the 芝浦 loop, the span, the 台場 approach.
 * Why not 400830346 (the second branch at 333682057, a layer-1 bridge of 84 m to the 台場 streets):
 * one continuation per direction keeps the chain a single line; that branch is left to GSI.
 */
export const STRUCTURE_SPECS: readonly StructureSpec[] = [
  {
    landmark: "rainbow_bridge",
    streets: {
      forward: [45177681, 4848879, 316305911, 4848754, 333682057, 23681347],
      backward: [45177678, 4848887, 316305913, 4848895],
    },
  },
];

export type DeckLevelName = "upper" | "lower";

/** One carriageway strip of a level, as the compiler builds it. */
export type StructureDeck = {
  /** `<landmark>:<level>:<direction>`. */
  id: string;
  level: DeckLevelName;
  direction: "forward" | "backward";
  cls: "expressway" | "street";
  /** OSM ways the strip names (osmWays): the chains through them are pinned over the girder. */
  ways: readonly number[];
  /** Centre offset of the carriageway strip (what the OSM line is checked against). */
  stripOffset: number;
  /** Centre offset of the band between the 壁高欄's inner faces (the run's centre line on the bridge). */
  bandOffset: number;
  section: XwSection;
  /** Render-only slab beyond each 壁高欄's outer face (m), left and right of travel. */
  aprons: { left: number; right: number };
};

export type Structure = {
  id: string;
  levels: DeckLevels;
  plane: Plane;
  /** Unit vector of +s in the plane (east, north). */
  along: [number, number];
  decks: StructureDeck[];
  /** Street ways compiled for this structure (all directions). */
  streetWays: number[];
};

const PARAPET = PARAPET_WIDTH.value;
const DRIVABLE: ReadonlySet<DeckStrip["kind"]> = new Set(["shoulder", "verge"]);

/**
 * The section of a carriageway strip: lanes and laneWidth as the strip says; each shoulder the
 * drivable strips (shoulder, verge) beside it up to the next barrier or the level's edge. A median
 * shared with the other direction is split: each side's 壁高欄 stands in its own half, back to back
 * at the median's centre. Beyond a 壁高欄 the slab goes on as an apron up to the level's edge or to
 * half way to the next carriageway (a guideway between two roads is split between them). Why not
 * the strip edges as walls everywhere: a 0.3 m fence strip is narrower than the 0.5 m 壁高欄 the deck
 * draws, so the wall stands from the fence's inner face outwards and the apron starts behind it.
 */
export function deckSection(
  level: DeckLevel,
  strip: DeckStrip,
): { section: XwSection; aprons: { left: number; right: number }; bandOffset: number } {
  const strips = [...level.strips].sort((a, b) => a.from - b.from);
  const at = strips.findIndex((s) => s.from === strip.from && s.to === strip.to);
  const edge = level.betweenOuterBarriers / 2;
  const isOtherRoad = (s: DeckStrip) => s.kind === "carriageway" && s !== strip;
  /** Walk from the carriageway towards +1 (larger offsets) or −1: drivable width, wall face, apron. */
  const walk = (dir: 1 | -1) => {
    let k = at + dir;
    let width = 0;
    while (k >= 0 && k < strips.length && DRIVABLE.has(strips[k].kind)) {
      width += strips[k].to - strips[k].from;
      k += dir;
    }
    const bandEdge = dir > 0 ? strip.to + width : strip.from - width;
    const isMedian = k >= 0 && k < strips.length && strips[k].kind === "median";
    if (isMedian) {
      // The wall's outer face on the median's centre: the band reaches into the median by its half less the wall.
      const half = (strips[k].to - strips[k].from) / 2;
      return { width: width + half - PARAPET, apron: 0 };
    }
    const wallOuter = bandEdge + dir * PARAPET;
    // Up to half way to the next road's band, or the level's edge.
    let limit = dir * edge;
    for (let j = k; j >= 0 && j < strips.length; j += dir) {
      if (!isOtherRoad(strips[j])) continue;
      let o = j - dir;
      while (o >= 0 && o < strips.length && DRIVABLE.has(strips[o].kind)) o -= dir;
      const otherBand = dir > 0 ? strips[o + dir].from : strips[o + dir].to;
      limit = (bandEdge + otherBand) / 2;
      break;
    }
    return { width, apron: Math.max(0, dir * (limit - wallOuter)) };
  };
  const plus = walk(1);
  const minus = walk(-1);
  // Left of travel is +offset for the forward carriageway (left-hand traffic, deckLevels.ts).
  const isForward = strip.direction === "forward";
  const left = isForward ? plus : minus;
  const right = isForward ? minus : plus;
  const lo = strip.from - minus.width;
  const hi = strip.to + plus.width;
  return {
    section: {
      lanes: strip.lanes!,
      laneWidth: strip.laneWidth!,
      shoulderL: round3(left.width),
      shoulderR: round3(right.width),
      median: 0,
      basis: "assumption",
    },
    aprons: { left: round3(left.apron), right: round3(right.apron) },
    bandOffset: round3((lo + hi) / 2),
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * East/north metres around a structure's origin on the WGS84 ellipsoid (the radii of curvature
 * there): the game places the landmark model by its origin and turns it by its bearing in its local
 * tangent frame (landmarks.ts, geo/frame.ts), so the axis must be measured in true metres. Why not
 * geo.ts planeAt (a sphere of mean radius): 0.2 % off east and north at 35.6°, which puts the line
 * "axis + offset" a metre away from the model's floor beams at the anchorages. The deckLevels'
 * station lon/lat are written with flat constants (rainbow_bridge_spec.py: 111,320·cos φ and
 * 110,540 m per degree) and stray from this axis by up to ~2 m at s = ±463 m; the axis (origin and
 * bearing, as the model is placed) is what the decks follow.
 */
function tangentPlaneAt(lon0: number, lat0: number): Plane {
  const a = 6378137;
  const e2 = 6.69437999014e-3;
  const phi = (lat0 * Math.PI) / 180;
  const w = 1 - e2 * Math.sin(phi) ** 2;
  const kx = ((a / Math.sqrt(w)) * Math.cos(phi) * Math.PI) / 180;
  const ky = (((a * (1 - e2)) / w ** 1.5) * Math.PI) / 180;
  return {
    lon0,
    lat0,
    toXY: (lon, lat) => [(lon - lon0) * kx, (lat - lat0) * ky],
    toLonLat: (x, y) => [lon0 + x / kx, lat0 + y / ky],
  };
}

/** The structure built from a landmark's deck levels and its street ways. */
export function structureFrom(spec: StructureSpec, levels: DeckLevels): Structure {
  const [lon0, lat0] = levels.axis.origin;
  const b = (levels.axis.bearing * Math.PI) / 180;
  const decks: StructureDeck[] = [];
  for (const name of ["upper", "lower"] as const) {
    const level = levels.levels[name];
    for (const strip of level.strips) {
      if (strip.kind !== "carriageway") continue;
      const { section, aprons, bandOffset } = deckSection(level, strip);
      decks.push({
        id: `${spec.landmark}:${name}:${strip.direction}`,
        level: name,
        direction: strip.direction!,
        cls: strip.use === "expressway" ? "expressway" : "street",
        ways: strip.osmWays ?? [],
        stripOffset: stripCentre(strip),
        bandOffset,
        section,
        aprons,
      });
    }
  }
  return {
    id: spec.landmark,
    levels,
    plane: tangentPlaneAt(lon0, lat0),
    along: [Math.sin(b), Math.cos(b)],
    decks,
    streetWays: Object.values(spec.streets).flat(),
  };
}

/** (s, offset) of a point: distance along the axis from its origin, and to its left. */
export function toAxis(st: Structure, lon: number, lat: number): { s: number; offset: number } {
  const [x, y] = st.plane.toXY(lon, lat);
  const [ax, ay] = st.along;
  return { s: x * ax + y * ay, offset: -x * ay + y * ax };
}

/** lon/lat of the point at (s, offset). */
export function fromAxis(st: Structure, s: number, offset: number): [number, number] {
  const [ax, ay] = st.along;
  return st.plane.toLonLat(s * ax - offset * ay, s * ay + offset * ax);
}

/** The deck that pins a way (one of the strip's osmWays), if any. */
export function deckOfWay(
  structures: readonly Structure[],
  way: number,
): { st: Structure; deck: StructureDeck } | null {
  for (const st of structures) for (const deck of st.decks) if (deck.ways.includes(way)) return { st, deck };
  return null;
}

/** Whether s lies within the structure's stations (sRange): where plan and profile are pinned. */
export const isOnStructure = (st: Structure, s: number): boolean =>
  s >= st.levels.axis.sRange[0] && s <= st.levels.axis.sRange[1];

/** Whether a pier at axis distance s would stand where the structure carries the decks. */
export const isPierFree = (st: Structure, s: number): boolean =>
  s >= st.levels.axis.pierFreeRange[0] && s <= st.levels.axis.pierFreeRange[1];

/** The surface of a deck at axis distance s: T.P. elevation and dz/ds along +s, by the formula. */
export function deckSurface(st: Structure, deck: StructureDeck, s: number): { z: number; grade: number } {
  return { z: deckHeight(st.levels, deck.level, s), grade: deckGrade(st.levels, s) };
}

export type OsmMismatch = {
  deck: string;
  way: number;
  s: number;
  offsetM: number;
  expectedM: number;
  deviationM: number;
};

/**
 * The 3 m rule: the largest horizontal distance, over the girder (girderRange), between a deck's OSM line (its ways'
 * polylines as [lon, lat]) and "axis + strip centre", sampled every metre. Returns the worst point.
 */
export function osmDeviation(
  st: Structure,
  deck: StructureDeck,
  way: number,
  pts: ReadonlyArray<readonly [number, number]>,
): OsmMismatch | null {
  let worst: OsmMismatch | null = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = toAxis(st, pts[i][0], pts[i][1]);
    const b = toAxis(st, pts[i + 1][0], pts[i + 1][1]);
    const len = Math.hypot(b.s - a.s, b.offset - a.offset);
    const n = Math.max(1, Math.ceil(len));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const s = a.s + (b.s - a.s) * t;
      const isOnGirder = s >= st.levels.axis.girderRange[0] && s <= st.levels.axis.girderRange[1];
      if (!isOnGirder) continue;
      const offset = a.offset + (b.offset - a.offset) * t;
      const deviationM = Math.abs(offset - deck.stripOffset);
      const isWorse = worst === null || deviationM > worst.deviationM;
      if (isWorse)
        worst = { deck: deck.id, way, s, offsetM: offset, expectedM: deck.stripOffset, deviationM };
    }
  }
  return worst;
}

/** Thrown when a structure's OSM lines or compiled decks break its tolerance: the build stops. */
export class StructureMismatchError extends Error {
  override readonly name = "StructureMismatchError";
}

/** Fail the build when a deck's OSM line strays beyond the horizontal tolerance (3 m). */
export function assertOsmMatches(st: Structure, deck: StructureDeck, found: OsmMismatch | null): void {
  if (found === null) {
    throw new StructureMismatchError(
      `${deck.id}: none of OSM ways ${deck.ways.join(", ")} reaches the structure (sRange ${st.levels.axis.sRange.join("…")} m)`,
    );
  }
  const tol = st.levels.tolerance.horizontal;
  const isTooFar = found.deviationM > tol;
  if (!isTooFar) return;
  throw new StructureMismatchError(
    `${deck.id}: OSM way ${found.way} is ${found.deviationM.toFixed(2)} m from axis + ${found.expectedM} m at s=${found.s.toFixed(1)} m (tolerance ${tol} m, OSM bias ${st.levels.osmBias.meanOffset} m recorded within it)`,
  );
}
